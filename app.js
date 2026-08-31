const BACKEND_URL = "https://sichtassist-backend.onrender.com/api/analyze";

const video = document.getElementById('cameraFeed');
const statusBox = document.getElementById('appStatus');
let isAnalyzing = false;
let isStarted = false;
let lastResult = ""; // Speichert das letzte Analyse-Ergebnis

// 1. AUDIO-BEEP (Erzeugt Piepton per Web Audio API)
function playBeep(freq = 880, duration = 0.15) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = freq;
        
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + duration);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.warn("AudioContext blockiert/nicht unterstützt");
    }
}

// 2. SPRACHAUSGABE (TTS)
function speak(text, callback) {
    window.speechSynthesis.cancel();
    
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

// 3. TASCHENLAMPE / BLITZ STEUERN
function toggleTorch(enable) {
    if (video.srcObject) {
        const tracks = video.srcObject.getVideoTracks();
        if (tracks.length > 0) {
            const track = tracks[0];
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};

            if (capabilities.torch) {
                track.applyConstraints({
                    advanced: [{ torch: enable }]
                }).then(() => {
                    speak(enable ? "Licht eingeschaltet" : "Licht ausgeschaltet", () => startListening());
                }).catch(() => {
                    speak("Licht konnte nicht geschaltet werden.", () => startListening());
                });
            } else {
                speak("Taschenlampe auf diesem Gerät nicht verfügbar.", () => startListening());
            }
        }
    }
}

// 4. SPRACHERKENNUNG (STT)
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

// 5. BEFEHLE VERARBEITEN
function handleCommand(command) {
    // Stopp-Befehl
    if (command.includes('stopp') || command.includes('halt') || command.includes('ruhe')) {
        stopAllOutput();
        return;
    }

    // Hilfe-Befehl für neue Nutzer
    if (command.includes('hilfe') || command.includes('befehle') || command.includes('optionen')) {
        playBeep(600, 0.1);
        speak(
            "Mögliche Befehle sind: Text, Farbe, Objekt, Geld, Licht an, Licht aus, Wiederholen, oder Stopp zum Anhalten.", 
            () => startListening()
        );
        return;
    }

    // Wiederholen-Befehl
    if (command.includes('wiederholen') || command.includes('nochmal')) {
        playBeep(600, 0.1);
        if (lastResult) {
            speak(lastResult, () => startListening());
        } else {
            speak("Keine vorherige Analyse vorhanden.", () => startListening());
        }
        return;
    }

    // Licht-Befehle
    if (command.includes('licht an') || command.includes('blitz an')) {
        playBeep(1000, 0.1);
        toggleTorch(true);
        return;
    }
    if (command.includes('licht aus') || command.includes('blitz aus')) {
        playBeep(400, 0.1);
        toggleTorch(false);
        return;
    }

    // Analyse-Modi
    if (command.includes('text') || command.includes('lesen')) {
        triggerAnalysis('text');
    } else if (command.includes('farbe')) {
        triggerAnalysis('color');
    } else if (command.includes('objekt') || command.includes('was ist das')) {
        triggerAnalysis('object');
    } else if (command.includes('geld') || command.includes('schein') || command.includes('münze')) {
        triggerAnalysis('currency');
    } else {
        speak("Nicht verstanden. Sage einen Modus wie Text oder Geld, oder sage Hilfe für alle Befehle.", () => startListening());
    }
}

// 6. BILD CAPTUREN
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

// 7. BACKEND ANFRAGE (mit Offline-Erkennung)
async function triggerAnalysis(mode) {
    // 1. Netzwerkprüfung vor dem Senden
    if (!navigator.onLine) {
        speak("Keine Internetverbindung verfügbar. Bitte prüfe deine Verbindung.", () => startListening());
        return;
    }

    if (isAnalyzing) return;
    isAnalyzing = true;
    
    playBeep(880, 0.15); // Bestätigungston beim Start der Analyse
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
            lastResult = data.result; // Für "wiederholen" speichern
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

// System-Listener für sofortige Rückmeldung bei Netzausfall
window.addEventListener('offline', () => {
    speak("Internetverbindung unterbrochen.");
});

window.addEventListener('online', () => {
    speak("Internetverbindung wiederhergestellt.", () => startListening());
});

// 8. ABBRUCH-FUNKTION (Bringt Sprachausgabe sofort zum Schweigen)
function stopAllOutput() {
    window.speechSynthesis.cancel();
    isAnalyzing = false;
    playBeep(440, 0.2);
    statusBox.textContent = "Angehalten.";
    setTimeout(startListening, 500);
}

// 9. INITIALISIERUNG / AUTOSTART
async function init() {
    if (isStarted) return;
    isStarted = true;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
        });
        video.srcObject = stream;
        
      
speak("StepFree SichtAssist bereit. Sage Text, Farbe, Objekt oder Geld. Für alle Optionen sage Hilfe.", () => {
    startListening();
});

    } catch (err) {
        console.error("Kamerafehler:", err);
        speak("Kamera-Zugriff verweigert. Bitte tippe einmal auf den Bildschirm.");
        isStarted = false;
    }
}

// --- EVENT LISTENER ---

window.addEventListener('DOMContentLoaded', () => {
    init();
});

// Tippen auf den Bildschirm bricht eine laufende Ansage sofort ab (oder startet die App)
document.body.addEventListener('click', (e) => {
    if (!isStarted) {
        init();
    } else if (window.speechSynthesis.speaking) {
        stopAllOutput();
    }
});

// Button-EventListener (verhindern Event-Bubbling)
document.getElementById('btnText').addEventListener('click', (e) => { e.stopPropagation(); triggerAnalysis('text'); });
document.getElementById('btnColor').addEventListener('click', (e) => { e.stopPropagation(); triggerAnalysis('color'); });
document.getElementById('btnObject').addEventListener('click', (e) => { e.stopPropagation(); triggerAnalysis('object'); });
document.getElementById('btnCurrency').addEventListener('click', (e) => { e.stopPropagation(); triggerAnalysis('currency'); });