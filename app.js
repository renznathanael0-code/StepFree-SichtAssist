const BACKEND_URL = "https://sichtassist-backend.onrender.com/api/analyze";

const video = document.getElementById('cameraFeed');
const statusBox = document.getElementById('appStatus');
let isAnalyzing = false;
let isStarted = false; // Verhindert mehrfaches Starten

// 1. SPRACHAUSGABE (TTS)
function speak(text, callback) {
    window.speechSynthesis.cancel();
    
    // Kleiner Buffer für iOS, damit cancel() sauber durchläuft
    setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'de-DE';
        utterance.rate = 1.0;
        
        utterance.onend = () => { if (callback) callback(); };
        utterance.onerror = (e) => { 
            console.error("TTS Fehler:", e); 
            if (callback) callback(); 
        };
        
        statusBox.textContent = text;
        window.speechSynthesis.speak(utterance);
    }, 50);
}

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

    recognition.onerror = () => {
        if (isStarted) setTimeout(startListening, 1000);
    };
    recognition.onend = () => {
        if (isStarted && !window.speechSynthesis.speaking && !isAnalyzing) startListening();
    };
}

function startListening() {
    if (recognition && !isAnalyzing && isStarted) {
        try { recognition.start(); } catch (e) {}
    }
}

// 3. BEFEHLE VERARBEITEN
function handleCommand(command) {
    if (command.includes('text') || command.includes('lesen')) triggerAnalysis('text');
    else if (command.includes('farbe')) triggerAnalysis('color');
    else if (command.includes('objekt') || command.includes('was ist das')) triggerAnalysis('object');
    else if (command.includes('geld') || command.includes('schein') || command.includes('münze')) triggerAnalysis('currency');
    else speak("Nicht verstanden. Bitte sage Text, Farbe, Objekt oder Geld.", () => startListening());
}

// 4. BILD CAPTUREN
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

// 5. BACKEND ANFRAGE
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
            speak(errorMsg, () => {
                isAnalyzing = false;
                startListening();
            });
        }

    } catch (err) {
        speak("Verbindungsfehler zum Backend.", () => {
            isAnalyzing = false;
            startListening();
        });
    }
}

// 6. INITIALISIERUNG / AUTOSTART
async function init() {
    if (isStarted) return;
    isStarted = true;

    try {
        // 1. Kamera starten (Facing environment -> Rückkamera)
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
        });
        video.srcObject = stream;
        
        // 2. Direkt sprechen! (Da Berechtigung auf der Domain schon erteilt ist)
        speak("StepFree SichtAssist bereit. Sage einen Befehl wie Text, Farbe, Objekt oder Geld.", () => {
            startListening();
        });
    } catch (err) {
        // Falls die Kamera blockiert wird:
        console.error("Kamerafehler:", err);
        speak("Kamera-Zugriff verweigert. Bitte tippe einmal auf den Bildschirm, um zu starten.");
        isStarted = false; // Ermöglicht manuelles Starten nach Klick
    }
}

// --- AUTOSTART AUSLÖSEN ---

// Startet, sobald das HTML-Gerüst geladen ist
window.addEventListener('DOMContentLoaded', () => {
    init();
});

// Fallback für iOS: Ein Klick irgendwo startet ebenfalls die App
document.body.addEventListener('click', init);
