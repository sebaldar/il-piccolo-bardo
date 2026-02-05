// server_base.js (o server_base.mjs)

import 'dotenv/config';
import { promises as fs } from 'fs';
import https from 'https';
import { URL } from 'url';
import querystring from 'querystring'; // Non usato nel codice, ma mantenuto per completezza
import path from 'path';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import os from 'os';

import MongoService from './js/services/service.mongo.js';
import MySQL2ServiceSingleton, { MySQL2Service } from './js/services/service.mariadb.js';
import neo4jService from './js/services/service.neo4j.js';

// Espandi le variabili d'ambiente che contengono $HOME
const BASE_ROOT = process.env.BASE_ROOT.replace('$HOME', os.homedir());
const DOC_ROOT = process.env.DOC_ROOT.replace('$HOME', os.homedir());
const SERVER_ROOT = process.env.SERVER_ROOT.replace('$HOME', os.homedir());

const INIZ = {
    DIR_SERVER_CLASS: './classes',
    SSL: { 
        DIR: process.env.SSL_DIR, 
        cert: process.env.SSL_CERT, 
        key: process.env.SSL_KEY, 
        ca: process.env.SSL_CA, 
        passphrase: process.env.SSL_PASSPHRASE 
    },
    CONFIG: {
        base_root: BASE_ROOT,
        doc_root: DOC_ROOT,
        session_dir: process.env.SESSION_DIR,
        server_root: SERVER_ROOT 
    }
};

const tools = {
    getContent: async (file) => { /* LOGICA ASINCRONA */ return fs.readFile(file, 'utf8') },
    parseCookies: (cookieHeader) => { 
        // Logica semplificata per la demo
        if (!cookieHeader) return {};
        const cookies = {};
        cookieHeader.split(';').forEach(cookie => {
            const parts = cookie.trim().split('=');
            cookies[parts[0]] = parts[1];
        });
        return cookies;
    },
    setLog: (msg) => { console.log(`[LOG] ${msg}`) }
};

const manage_post = {
    exe: (request, binary) => {
        console.log('ATTENZIONE: parsing multipart/form-data delegato, implementare con libreria!');
        return {}; 
    }
};
// -------------------------------------------------------------------
// Crea le istanze multiple
const dbUser = new MySQL2Service({
    host: process.env.BALDOWEB_USER_HOST ,
    user: process.env.BALDOWEB_USER_USER,
    password: process.env.BALDOWEB_USER_PASS,
    database: process.env.BALDOWEB_USER_DB 
});


// Array per tracciare tutte le connessioni
const mysqlConnections = [MySQL2ServiceSingleton, dbUser];

// Export per usarle altrove
export { dbUser };


// Variabile per tracciare se la chiusura è già in corso
let isShuttingDown = false;

async function handleSignal(signal) {
    if (isShuttingDown) {
        console.log('⚠️ Chiusura già in corso...');
        return;
    }
    
    isShuttingDown = true;
    console.log(`\n🛑 Ricevuto segnale ${signal}. Chiusura server in corso...`);
    
    const shutdownPromises = [];
    
    // Chiude MongoDB
    if (MongoService) {
        shutdownPromises.push(
            MongoService.close()
                .then(() => console.log("✅ MongoDB chiuso correttamente"))
                .catch(err => console.error("❌ Errore chiusura MongoDB:", err.message))
        );
    }
    
    // Chiude tutte le connessioni MySQL/MariaDB
    mysqlConnections.forEach((mysqlInstance, index) => {
        if (mysqlInstance && mysqlInstance.isConnected()) {
            shutdownPromises.push(
                mysqlInstance.close()
                    .then(() => console.log(`✅ MySQL/MariaDB ${index > 0 ? `#${index + 1}` : ''} chiuso correttamente`))
                    .catch(err => console.error(`❌ Errore chiusura MySQL/MariaDB ${index > 0 ? `#${index + 1}` : ''}:`, err.message))
            );
        }
    });
    
    // Chiude Neo4j
    if (neo4jService) {
        shutdownPromises.push(
            neo4jService.close()
                .then(() => console.log("✅ Neo4j chiuso correttamente"))
                .catch(err => console.error("❌ Errore chiusura Neo4j:", err.message))
        );
    }
    
    // Aspetta che tutte le connessioni vengano chiuse
    try {
        await Promise.allSettled(shutdownPromises);
        console.log("✅ Tutte le connessioni chiuse");
    } catch (err) {
        console.error("❌ Errore durante la chiusura:", err.message);
    }
    
    // Timeout di sicurezza: forza l'uscita dopo 10 secondi
    setTimeout(() => {
        console.log("⏱️ Timeout scaduto, uscita forzata");
        process.exit(1);
    }, 10000);
    
    process.exit(0);
}

// Gestione segnali
process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));

// Gestione errori non catturati (opzionale ma consigliato)
process.on('uncaughtException', (err) => {
    console.error('❌ Errore non catturato:', err);
    handleSignal('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejection non gestita:', reason);
    handleSignal('unhandledRejection');
});

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));


export default class Server { // Export della classe (default)

    constructor(port) {
        this.host = '0.0.0.0';
        this.port = port;
        this.CLIENTS = {};
        this.srv_https = null; 
        this.wss = null;
        this.PING_INTERVAL = 30000; // Intervallo Ping Heartbeat (30 secondi)
        this.interval = null;
        console.log(INIZ)
    }

    /**
     * @static Genera un ID di sessione crittograficamente sicuro.
     */
    static generateSessionId() {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Verifica se una stringa è un Session ID valido nel formato aspettato (32 caratteri hex).
     * @param {string} sessionId L'ID di sessione da verificare.
     * @returns {boolean} True se l'ID è nel formato corretto.
     */
     isValidSessionIdFormat(sessionId) {
        // Il pattern: ^ (inizio stringa), [0-9a-fA-F] (caratteri esadecimali), {32} (esattamente 32 volte), $ (fine stringa)
        const hex32Pattern = /^[0-9a-fA-F]{32}$/;

        // 1. Verifica che non sia null/undefined e che sia una stringa
        if (typeof sessionId !== 'string' || !sessionId) {
            return false;
        }

        // 2. Verifica tramite espressione regolare
        return hex32Pattern.test(sessionId);
    }
    
    /**
     * @static Gestisce la risposta Pong del client.
     */
    static pongHandler() {
        this.isAlive = true;
    }

    
    // Nel metodo init()
    async init() {
        const ssl_dir = INIZ.SSL.DIR;
        tools.setLog('Inizializzazione server e lettura chiavi SSL...');
        
        try {
            // --- 🔌 CONNESSIONE MONGODB ---
            await MongoService.connect(
                "mongodb://127.0.0.1:27017",
                "gestiondb"
            );
            tools.setLog("✅ MongoDB inizializzato");
            
            // --- 🔌 CONNESSIONE MARIADB (TUTTE LE ISTANZE) ---
            const mysqlPromises = mysqlConnections.map(async (db, index) => {
                try {
                    await db.connect();
                    const name = index === 0 ? 'principale' : `#${index + 1}`;
                    tools.setLog(`✅ MariaDB ${name} inizializzato`);
                } catch (error) {
                    console.error(`❌ Errore connessione MariaDB ${index}:`, error.message);
                    throw error;
                }
            });
            
            await Promise.all(mysqlPromises);
            
            // --- 🔌 CONNESSIONE NEO4J ---
            try {
              // Connessione con retry automatico
              await neo4jService.connect(
                process.env.NEO4J_URI,
                process.env.NEO4J_USER,
                process.env.NEO4J_PASSWORD,
                process.env.NEO4J_DEFAULT_DB
              );
              tools.setLog("✅ Neo4j inizializzato");
              
              // Health check completo
              const health = await neo4jService.healthCheck();
              if (health.healthy) {
                tools.setLog("✅ Neo4j health check OK");
              } else {
                tools.setLog(`⚠️ Neo4j warning: ${health.error}`);
              }
              
              // Mostra info connessione
              const info = neo4jService.getConnectionInfo();
              tools.setLog(`📊 Database: ${info.database} @ ${info.uri}`);
              
            } catch (error) {
              tools.setLog(`❌ Errore Neo4j: ${error.message}`);
              throw error;
            }        
            
            
            const options = {
                cert: await fs.readFile(path.join(ssl_dir, INIZ.SSL.cert)),
                key: await fs.readFile(path.join(ssl_dir, INIZ.SSL.key)),
                ca: await fs.readFile(path.join(ssl_dir, INIZ.SSL.ca)),  // ← AGGIUNGI QUESTA RIGA
                passphrase: INIZ.SSL.passphrase
            };
                
            this.srv_https = https.createServer(options, this.handleHttpRequest.bind(this));
                
            this.wss = new WebSocketServer({ 
              server: this.srv_https, 
              clientTracking: true 
            });
            
            this.wss.on('connection', this.handleWsConnection.bind(this));
            
        } catch (error) {
            console.error("❌ FATAL: Errore durante l'inizializzazione:", error.message);
            await this.cleanup();
            process.exit(1);
        }
    }

    async cleanup() {
      console.log("🧹 Pulizia risorse in corso...");
      
      const cleanupPromises = [];
      
      // MongoDB
      if (MongoService && MongoService.isConnected()) {
          cleanupPromises.push(
              MongoService.close()
                  .then(() => console.log("✅ MongoDB chiuso"))
                  .catch(err => console.error("❌ Errore chiusura MongoDB:", err.message))
          );
      }
      
      // Tutte le istanze MySQL
      mysqlConnections.forEach((db, index) => {
          if (db && db.isConnected()) {
              cleanupPromises.push(
                  db.close()
                      .then(() => console.log(`✅ MariaDB ${index === 0 ? 'principale' : `#${index + 1}`} chiuso`))
                      .catch(err => console.error(`❌ Errore chiusura MariaDB ${index}:`, err.message))
              );
          }
      });
      
      // Neo4j
      if (neo4jService) {
          cleanupPromises.push(
              neo4jService.close()
                  .then(() => console.log("✅ Neo4j chiuso"))
                  .catch(err => console.error("❌ Errore chiusura Neo4j:", err.message))
          );
      }
      
      await Promise.allSettled(cleanupPromises);
  }


    startHeartbeat() {
        this.interval = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    tools.setLog(`Terminando client inattivo: ${ws.clientData['sec-websocket-key']}`);
                    return ws.terminate();
                }
                ws.isAlive = false;
                ws.ping();
            });
        }, this.PING_INTERVAL);
    }
    
    async loadContext(request) {
        // La creazione dell'oggetto URL con `new URL(string, base)` è identica in ESM.
        const parsedUrl = new URL(request.url, `https://${request.headers.host}`);
        
        let FILE_CONFIG = parsedUrl.searchParams.get('config_file') || "./server/config.json";
        console.log(process.cwd())
        const data_config = await tools.getContent(FILE_CONFIG);
        const impostazioni = JSON.parse(data_config);

        const queryParams = Object.fromEntries(parsedUrl.searchParams.entries());

        return { 
            impostazioni, 
            queryParams,
            parsedUrl,
        };
    }

    /**
     * Handler ASINCRONO per tutte le richieste HTTP (GET, POST, ecc.).
     * **Responsabile di creare la SESSIONID e inviare il cookie sicuro.**
     */
    async handleHttpRequest(request, response) {
        let jdata = { request, response };
        try {
            const context = await this.loadContext(request);
            const { impostazioni, queryParams, parsedUrl } = context;
            const pathname = parsedUrl.pathname;
            
            const parsed_pathname = path.parse(pathname);
            /*
             * se pathname /api/session
            {
            *   root: '/',
            *   dir: '/api',
            *   base: 'session',
            *   ext: '',
            *   name: 'session'
            * }
            */

            // 1. GESTIONE CODICE DI SESSIONE (NUOVO o CREAZIONE)
            const cookies = tools.parseCookies(request.headers.cookie);
            let session_id = cookies.SESSIONID;

            // Genera una nuova sessione se non esiste
            if (!session_id || !this.isValidSessionIdFormat(session_id)) {
                session_id = Server.generateSessionId();
                response.setHeader('Set-Cookie', `SESSIONID=${session_id}; HttpOnly; Secure; SameSite=Strict; Path=/`);
                tools.setLog(`HTTP: Creata nuova sessione e inviato Set-Cookie: ${session_id}`);
            } else {
                tools.setLog(`HTTP: Sessione esistente trovata: ${session_id}`);
            }

            // Ora che session_id è sicuramente una stringa valida, crea il percorso
            const session_dir = path.join(INIZ.CONFIG.base_root, INIZ.CONFIG.session_dir, session_id);

            // Crea la directory di sessione (se non esiste)
            await fs.mkdir(session_dir, { recursive: true });

            jdata = {
                ...jdata,
                impostazioni,
                url: request.url,
                pagina: pathname,
                query: queryParams,
                dir: path.dirname(pathname),
                doc: path.basename(pathname),
                header: request.headers,
                SESSION: session_id,
                session_dir: session_dir,
            };

            // 2. Gestione POST (da implementare)
            switch ( request.method ) {
              case "POST" : {
              }
              break;
              case "GET" : {
              }
            }

            // 3. Esecuzione del Comando
            await this.http_command(jdata);

        } catch (error) {
            console.error(`Errore nell'handler HTTP: ${error.message}`);
            if (!response.finished) {
                response.writeHead(500, { 'Content-Type': 'text/plain' });
                response.end('Internal Server Error');
            }
        }
    }

    
    /**
     * Handler ASINCRONO per la connessione WebSocket.
     * **Recupera il SESSIONID dal cookie impostato da HTTPS.**
     */
    /**
     * Handler ASINCRONO per la connessione WebSocket.
     * **Recupera il SESSIONID dal cookie impostato da HTTP.**
     */
    async handleWsConnection(ws, request) {
       let jdata = { request, ws };
       try {
            const context = await this.loadContext(request);
            const { impostazioni, queryParams, parsedUrl } = context;
            const pathname = parsedUrl.pathname;
            
            const parsed_pathname = path.parse(pathname);
            /*
             * se pathname /api/session
            {
            *   root: '/',
            *   dir: '/api',
            *   base: 'session',
            *   ext: '',
            *   name: 'session'
            * }
            */

            const sec_websocket_key = request.headers['sec-websocket-key'];
            const client_ip = request.socket.remoteAddress;

            // *** RECUPERA SESSIONID DAL COOKIE (non da queryParams!) ***
            const cookies = tools.parseCookies(request.headers.cookie);
            const session_id = cookies.SESSIONID;

            // Se non c'è sessione valida, RIFIUTA la connessione
            if (!session_id || !this.isValidSessionIdFormat(session_id)) {
                tools.setLog(`WSS: Connessione rifiutata da ${client_ip} - nessuna sessione valida`);
                ws.close(1008, 'Unauthorized: No valid session cookie');
                return;
            }

            // Opzionale: verifica che la sessione esista nel filesystem/DB
            const session_dir = path.join(INIZ.CONFIG.base_root, INIZ.CONFIG.session_dir, session_id);
            try {
                await fs.access(session_dir);
                tools.setLog(`WSS: Sessione valida trovata: ${session_id}`);
            } catch {
                tools.setLog(`WSS: Sessione ${session_id} non trovata su disco`);
                ws.close(1008, 'Unauthorized: Session expired');
                return;
            }

            jdata = {
                ...jdata,
                impostazioni,
                url: request.url,
                pagina: pathname,
                query: queryParams,
                dir: path.dirname(pathname),
                doc: path.basename(pathname),
                header: request.headers,
                SESSION: session_id,
                session_dir: session_dir,
            };

            ws.isAlive = true;
            ws.on('pong', Server.pongHandler.bind(ws)); 
            ws.clientData = { 
                client_ip, 
                query: jdata.query, 
                ws, 
                session_dir, 
                session_id, // Aggiungi per riferimento
                'sec-websocket-key': sec_websocket_key 
            };
            
            this.CLIENTS[sec_websocket_key] = ws.clientData;
            
            await this.updateClientIps(client_ip, session_dir);
            await this.ensureUserFileExists(session_dir);
            
            tools.setLog(`WSS: Connesso da ${client_ip}. Sessione: ${session_id}. Totale clients: ${Object.keys(this.CLIENTS).length}`);
            
            // Configurazione degli handler
            ws.on('message', (data, isBinary) => this.handleWsMessage(ws, data, isBinary, jdata));
            ws.on('close', () => this.handleWsClose(ws, request));
            ws.on('error', (error) => console.error(`WS Error for ${sec_websocket_key}:`, error.message));

            await this.on_my_ws_connection(ws, jdata);
            
        } catch (error) {
            console.error(`Errore durante la connessione WebSocket: ${error.message}`);
            ws.terminate(); 
        }
    }    


    /**
     * Aggiorna il file degli IP dei client connessi
     */
    async updateClientIps(client_ip, session_dir) {
        try {
            const ip_file = path.join(session_dir, 'client_ips.json');
            let ips = [];
            
            try {
                const data = await fs.readFile(ip_file, 'utf8');
                ips = JSON.parse(data);
            } catch (err) {
                // File non esiste, crea array vuoto
            }
            
            if (!ips.includes(client_ip)) {
                ips.push(client_ip);
                await fs.writeFile(ip_file, JSON.stringify(ips, null, 2));
            }
        } catch (error) {
            console.error('Errore updateClientIps:', error.message);
        }
    }

    /**
     * Assicura che il file utente esista
     */
    async ensureUserFileExists(session_dir) {
        try {
            const user_file = path.join(session_dir, 'user.json');
            
            try {
                await fs.access(user_file);
            } catch {
                // File non esiste, crealo
                const defaultUser = {
                    id: Server.generateSessionId(),
                    created: new Date().toISOString(),
                    data: {}
                };
                await fs.writeFile(user_file, JSON.stringify(defaultUser, null, 2));
            }
        } catch (error) {
            console.error('Errore ensureUserFileExists:', error.message);
        }
    }

    /**
     * Gestisce i messaggi WebSocket
     */
    async handleWsMessage(ws, data, isBinary, jdata) {
        try {
            const message = isBinary ? data : data.toString();
            
            try {
                const parsed = JSON.parse(message);
                jdata.message = parsed;
                await this.wss_command(this, ws, jdata);
            } catch {
                // Non è JSON, gestisci come testo
                jdata.message = { type: 'text', data: message };
                await this.wss_command(this, ws, jdata);
            }
        } catch (error) {
          console.error('Errore handleWsMessage:\n', error.stack);
        }
    }

    /**
     * Gestisce la chiusura della connessione WebSocket
     */
    handleWsClose(ws, request) {
        const sec_websocket_key = request.headers['sec-websocket-key'];
        
        if (this.CLIENTS[sec_websocket_key]) {
            delete this.CLIENTS[sec_websocket_key];
            tools.setLog(`Client disconnesso: ${sec_websocket_key}. Totale clients: ${Object.keys(this.CLIENTS).length}`);
        }
        
        this.on_my_ws_close(ws, request);
    }

    /**
     * Scrive log locale per il client
     */
    async setLocalLog(ws, jdata, message) {
        try {
            const log_file = path.join(jdata.session_dir, 'ws_errors.log');
            const timestamp = new Date().toISOString();
            const log_entry = `${timestamp}: ${message}\n`;
            await fs.appendFile(log_file, log_entry);
        } catch (error) {
            console.error('Errore setLocalLog:', error.message);
        }
    }

    /**
     * Hook per la connessione WebSocket (override in classi derivate)
     */
    async on_my_ws_connection(ws, jdata) {
        // Override questo metodo nelle classi derivate
        console.log('[WSS] Nuova connessione WebSocket');
    }

    /**
     * Hook per la chiusura WebSocket (override in classi derivate)
     */
    async on_my_ws_close(ws, request) {
        // Override questo metodo nelle classi derivate
        console.log('[WSS] Connessione WebSocket chiusa');
    }
        
    listen() {
        if (!this.srv_https) {
            console.error("Il server non è inizializzato. Chiamare prima il metodo .init()");
            return;
        }
        const h_port = this.port;

        const d = new Date();
        console.log(`${d.toISOString().split('T')[0]} ${d.toTimeString().split(' ')[0]} : process ID ${process.pid}`);
        
        this.srv_https.listen(h_port, this.host, () => {
            console.log(`Listening on https://${this.host}:${h_port} and wss://${this.host}:${h_port}`);
            this.startHeartbeat(); 
        });
    }

    async http_command(jdata) {
        // Ora puoi accedere all'ID di sessione sicuro tramite jdata.SESSION
        console.log(`[HTTP] Sessione attiva: ${jdata.SESSION}`); 
        if (!jdata.response.finished) {
             jdata.response.writeHead(200, { 'Content-Type': 'text/plain' });
             jdata.response.end(`Richiesta gestita: ${jdata.pagina} (Sessione: ${jdata.SESSION})`);
        }
    }

    async wss_command(server, ws, jdata) {
        // Ora puoi accedere all'ID di sessione sicuro anche qui
        console.log(`[WSS] Comando ricevuto (${jdata.query.command || 'N/A'}). Sessione: ${jdata.SESSION}`);
    }
    
   
}


// Esempio di utilizzo (ora come Top-Level await)
// Nota: in un file .mjs (o con "type": "module") puoi usare Top-Level await
/*
(async () => {
    const server = new Server(8080);
    await server.init(); // Chiamata al metodo ASINCRONO di inizializzazione
    server.listen();
})();
*/
