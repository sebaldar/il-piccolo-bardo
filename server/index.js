// index.js

import * as dotenv from 'dotenv';
// Nota: Importiamo i moduli di Node.js senza l'estensione .js
import fs from 'fs'; 
import os from 'os';

// Importazione della classe Server (presumendo che sia un default export)
import Server from './server_base.js'; 
import wss_command from './js/wss_command.js'; 
import http_command from './js/http_command.js'; 

// Carica le variabili d'ambiente (dal file .env)
dotenv.config();

class the_server extends Server {

    constructor( port ) {
        super( port );
    }
     
    http_command ( jdata ) {
        super.http_command( jdata );
        http_command.exe( jdata );
    }
     
    wss_command ( server, ws, jdata ) {
        super.wss_command( server, ws, jdata );
        wss_command.exe( server, ws, jdata );
    }
     
    async on_my_ws_connection ( ws, jdata ) {
         
        super.on_my_ws_connection( ws, jdata );

    }
     
    async on_my_ws_close ( ws, request ) {
         
        super.on_my_ws_close( ws, request );

    }
     
     
    thread() {
        // Logica per thread
    }
     
    async inizDB () {
        // Logica per inizializzazione DB
    }


}

// Avvio del server con Top-Level await
(async () => {
    try {
        console.log('🚀 Avvio applicazione...');
        
        const server = new the_server(process.env.WSS_PORT);
        
        // Inizializzazione COMPLETA prima di fare qualsiasi altra cosa
        await server.init();
        
        console.log('✅ Inizializzazione completata');
        
        // Ora puoi chiamare listen() e thread() in sicurezza
        server.listen();
        server.thread();
        
        console.log(`✅ Server avviato e in ascolto sulla porta ${process.env.WSS_PORT}`);
        
    } catch (error) {
        console.error('❌ ERRORE FATALE durante l\'avvio del server:', error);
        process.exit(1);
    }
})();
