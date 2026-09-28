const fs = require('fs');
const file = 'public/styles.css';
let css = fs.readFileSync(file, 'utf8');

// Replace Casino Table CSS
css = css.replace(/\.casino-table \{[\s\S]*?\}/, `.casino-table {
    flex: 1;
    background: radial-gradient(ellipse at center, #1a8f3d 0%, #064014 100%);
    border: 20px solid #4a2f1d;
    border-radius: 200px; /* Stadium shape like in the image */
    box-shadow: 
        0 0 0 10px #2a1f1a, 
        inset 0 0 30px rgba(0,0,0,0.8),
        0 20px 50px rgba(0,0,0,0.9);
    margin: 10px auto;
    width: 95vw;
    max-width: 1200px;
    position: relative; /* Crucial for absolute children */
    box-sizing: border-box;
}`);

// Add Chat Header CSS
css += `
#chat-header {
    background: rgba(255, 215, 0, 0.2);
    color: #ffd700;
    padding: 5px 10px;
    font-size: 12px;
    font-weight: bold;
    cursor: grab;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px 10px 0 0;
    user-select: none;
}
#chat-header:active {
    cursor: grabbing;
}
`;

// Replace Dealer Area CSS
css = css.replace(/\.dealer-area \{ text-align: center; margin: 15px 0; \}/, `.dealer-area { 
    position: absolute; 
    top: 50%; 
    left: 50%; 
    transform: translate(-50%, -50%); 
    text-align: center; 
    width: 300px; 
    z-index: 5;
}`);

// Replace players container CSS
css = css.replace(/\.players-container \{[\s\S]*?\}/, `.players-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none; /* Let clicks pass through table */
}`);

// Replace player CSS
css = css.replace(/\.player \{[\s\S]*?\}/, `.player {
    position: absolute;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid #555;
    padding: 10px;
    border-radius: 12px;
    text-align: center;
    width: 130px;
    box-shadow: 0 5px 15px rgba(0,0,0,0.5);
    pointer-events: auto; /* Re-enable clicks */
    display: flex;
    flex-direction: column-reverse; /* Put cards on top, name on bottom like the image */
    align-items: center;
    z-index: 10;
}`);

// We need to adjust cards-container inside player because column-reverse puts it above text, but maybe it needs special margin.
css += `
.player .cards-container {
    margin-bottom: -15px; /* Pull it down slightly towards the nameplate */
    margin-top: -30px; /* Pull it up out of the box */
    z-index: 11;
}
`;

fs.writeFileSync(file, css);
console.log('CSS patched!');
