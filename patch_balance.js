const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

// Replace balance assignments and resets
content = content.replace(/balance: 1000/g, 'balance: 10000');
content = content.replace(/balance = 1000/g, 'balance = 10000');

fs.writeFileSync(file, content);
console.log('Balance patched to 10000!');
