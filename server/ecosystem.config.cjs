module.exports = {
  apps: [{
    name: 'ilpiccolobardo',
    cwd: '/home/dedalo/IL_PICCOLO_BARDO/',
    script: 'server/index.js',
    out_file: 'server/logs/out.log',
    error_file: 'server/logs/err.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',  // utile: aggiunge timestamp leggibile nei log
    env: {
      NODE_ENV: 'production'
    }
  }]
};
