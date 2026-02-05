import fs from 'fs';

// Import dinamici: li faremo al bisogno nel metodo executeRequest.
// Ogni modulo lo importeremo con import().

// Classe WSS
class HTTP {

    constructor( jdata ) {
        this.jdata = jdata;
    }

    async executeRequest() {

        const jdata = this.jdata;

        // Funzione helper per importare moduli ES dinamicamente
        const load = async (path) => {
            const mod = await import(`file://${process.cwd()}/js/pagine/${path}.js`);
            return mod.default || mod; // supporta sia export default che named
        };

        const pagina = "";
        switch (pagina) {


        }
    }
}


// Esportazione del modulo principale
export default {
    exe( jdata ) {
        const h = new HTTP(jdata);
        h.executeRequest();
    }
};
