const BACKEND_URL = "https://sichtassist-backend.onrender.com/api/analyze";

const video = document.getElementById('cameraFeed');
const statusBox = document.getElementById('appStatus');
let isAnalyzing = false;

// 1. SPRACHAUSGABE (TTS) - Für iOS/Safari optimiert
function speak(text, callback) {
    // Falls noch Sprache läuft, abbrechen
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';
    utterance.rate = 1.0;

    utterance.onend = () => { if (callback) callback(); };
    utterance.onerror = (e) => { 
        console.error("TTS Fehler:", e); 
        if (callback) callback(); 
    };

    statusBox.textContent = text;

    // Workaround für iOS: Kurze Verzögerung nach cancel() einbauen
    setTimeout(() => {
        window.speechSynthesis.speak(utterance);
    }, 50);
}

// Erster Klick schaltet Audio & Kamera auf dem iPad/iPhone frei
document.body.addEventListener('click', () => {
    // Dummy-Audio-Trigger schaltet iOS Audio-Session frei
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    init();
}, { once: true });

// 2. SPRACHERKENNUNG (STT)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'de-DE';
    recognition.continuous = false;

    recognition.onresult = (event) => {
        const command = event.results[0][0].transcript.toLowerCase();
        handleCommand(command);
    };

    recognition.onerror = () => setTimeout(startListening, 1000);
    recognition.onend = () => {
        if (!window.speechSynthesis.speaking && !isAnalyzing) startListening();
    };
}

function startListening() {
    if (recognition && !isAnalyzing) {
        try { recognition.start(); } catch (e) {}
    }
}

// 3. BEFEHLE VERARBEITEN (Neue 4 Modi)
function handleCommand(command) {
    if (command.includes('text') || command.includes('lesen')) triggerAnalysis('text');
    else if (command.includes('farbe')) triggerAnalysis('color');
    else if (command.includes('objekt') || command.includes('was ist das')) triggerAnalysis('object');
    else if (command.includes('geld') || command.includes('schein') || command.includes('münze')) triggerAnalysis('currency');
    else speak("Nicht verstanden. Bitte sage Text, Farbe, Objekt oder Geld.", () => startListening());
}

// 4. BILD CAPTUREN & OPTIMIERT SKALIEREN / KOMPRIMIEREN
function captureImageBase64() {
    const canvas = document.createElement('canvas');
    const maxWidth = 1024;
    const scale = maxWidth / (video.videoWidth || 640);
    
    canvas.width = maxWidth;
    canvas.height = (video.videoHeight || 480) * scale;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    return canvas.toDataURL('image/jpeg', 0.7);
}

// 5. ANFRAGE AN DEIN RENDER-BACKEND SCHICKEN
async function triggerAnalysis(mode) {
    if (isAnalyzing) return;
    isAnalyzing = true;
    speak("Analysiere Bild, bitte warten...", null);

    try {
        const imageBase64 = captureImageBase64();

        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64, mode })
        });

        const data = await response.json();

        if (response.ok && data.result) {
            speak(data.result, () => {
                isAnalyzing = false;
                startListening();
            });
        } else {
            const errorMsg = data.details || data.error || "Fehler bei der Bildanalyse.";
            console.error("API Fehler Details:", errorMsg);
            speak(errorMsg, () => {
                isAnalyzing = false;
                startListening();
            });
        }

    } catch (err) {
        console.error("Netzwerkfehler:", err);
        speak("Verbindungsfehler zum Backend.", () => {
            isAnalyzing = false;
            startListening();
        });
    }
}

// 6. KAMERA STARTEN
async function init() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        speak("StepFree SichtAssist bereit. Sage einen Befehl wie Text, Farbe, Objekt oder Geld.", () => startListening());
    } catch (err) {
        speak("Kamera-Zugriff verweigert.");
    }
}

// Event Listener für Knöpfe (Text, Farbe, Objekt, Geld)
document.getElementById('btnText').addEventListener('click', () => triggerAnalysis('text'));
document.getElementById('btnColor').addEventListener('click', () => triggerAnalysis('color'));
document.getElementById('btnObject').addEventListener('click', () => triggerAnalysis('object'));
document.getElementById('btnCurrency').addEventListener('click', () => triggerAnalysis('currency'));

document.body.addEventListener('click', () => { init(); }, { once: true });  

// Für Screenreader & Sehbehinderte: Erster Touch irgendwo auf dem Display startet die App
function handleFirstInteraction() {
    // Schaltet Audio-Session auf iOS/Android frei
    const startUtterance = new SpeechSynthesisUtterance("Starten");
    startUtterance.lang = "de-DE";
    window.speechSynthesis.speak(startUtterance);

    // Startet Kamera & Spracherkennung
    init();

    // Event-Listener entfernen, damit er nur 1x ausführt
    window.removeEventListener('touchstart', handleFirstInteraction);
    window.removeEventListener('click', handleFirstInteraction);
}

// Reagiert sowohl auf Berührung (Touch) als auch auf Mausklick
window.addEventListener('touchstart', handleFirstInteraction, { once: true });
window.addEventListener('click', handleFirstInteraction, { once: true });