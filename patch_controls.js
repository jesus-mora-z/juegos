const fs = require('fs');
const file = 'public/styles.css';
let css = fs.readFileSync(file, 'utf8');

// Replace .controls CSS entirely
css = css.replace(/\.controls \{[\s\S]*?\}/, `.controls {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    pointer-events: none; /* Allows clicking through the empty space */
    z-index: 100;
}

#playing-controls, #poker-playing-controls {
    position: absolute;
    bottom: 20px;
    left: 20px;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(10px);
    border-radius: 15px;
    border: 1px solid rgba(255,255,255,0.2);
    box-shadow: 0 5px 20px rgba(0,0,0,0.6);
    padding: 15px;
    pointer-events: auto;
    display: flex;
    gap: 10px;
    align-items: center;
}

#betting-controls, #poker-start-control {
    position: absolute;
    bottom: 20px;
    right: 20px;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(10px);
    border-radius: 15px;
    border: 1px solid rgba(255,255,255,0.2);
    box-shadow: 0 5px 20px rgba(0,0,0,0.6);
    padding: 15px;
    pointer-events: auto;
    display: flex;
    gap: 10px;
    align-items: center;
}`);

// Also fix .bet-group to be cleaner
css = css.replace(/\.bet-group \{[\s\S]*?\}/, `.bet-group {
    display: flex;
    flex-direction: column;
    margin: 0;
    text-align: left;
}`);

fs.writeFileSync(file, css);
console.log('Controls CSS patched!');
