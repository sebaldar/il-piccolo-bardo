import fs from 'fs';

// Import dinamici: li faremo al bisogno nel metodo executeRequest.
// Ogni modulo lo importeremo con import().

// Classe WSS
class WSS {

    constructor(server, ws, data) {
        this.server = server;
        this.ws = ws;
        this.data = data;
        this.wss_port = server.wss_port;
    }

    async executeRequest() {
        const server = this.server;
        const ws = this.ws;
        const jdata = this.data;
        const pagina = jdata.message.pagina;

        // Funzione helper per importare moduli ES dinamicamente
        const load = async (path) => {
            const mod = await import(`file://${process.cwd()}/js/pagine/${path}.js`);
            return mod.default || mod; // supporta sia export default che named
        };

        switch (pagina) {

            case "IL_PICCOLO_BARDO" : {
                const piccolobardo = await load("IL_PICCOLO_BARDO/main");
                await piccolobardo.exe( ws, jdata.message);
            }					
            break;

        }
    }
}


// Esportazione del modulo principale
export default {
    exe(server, ws, jdata) {
        const h = new WSS(server, ws, jdata);
        h.executeRequest();
    }
};
