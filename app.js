const BACKEND_URL = "https://sichtassist-backend.onrender.com/api/analyze";


const video = document.getElementById('cameraFeed');
const statusBox = document.getElementById('appStatus');
let isAnalyzing = false;
let isStarted = false;
let isWaitingForSearchTarget = false;
let searchTimeoutTimer = null;
let lastResult = "";

// 1. AUDIO-BEEP
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

function playMicActiveBeep() {
    playBeep(1200, 0.08);
}

// 2. SPRACHAUSGABE (TTS)
function speak(text, callback) {
    stopListening();
    window.speechSynthesis.cancel();
    
    setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'de-DE';
        utterance.rate = 1.0;
        
        utterance.onend = () => { 
            if (callback) setTimeout(callback, 400); 
        };
        
        utterance.onerror = (e) => { 
            console.error("TTS Fehler:", e); 
            if (callback) setTimeout(callback, 400); 
        };
        
        statusBox.textContent = text;
        window.speechSynthesis.speak(utterance);
    }, 150);
}

// 3. TASCHENLAMPE STEUERN
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

// 4. SPRACHERKENNUNG (STT) STEUERUNG
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'de-DE';
    recognition.continuous = false;

    recognition.onresult = (event) => {
        stopListening();
        const command = event.results[0][0].transcript.toLowerCase();
        handleCommand(command);
    };

    recognition.onerror = () => {
        if (isStarted && !window.speechSynthesis.speaking) setTimeout(startListening, 1000);
    };
    
    recognition.onend = () => {
        if (isStarted && !window.speechSynthesis.speaking && !isAnalyzing) {
            setTimeout(startListening, 300);
        }
    };
}

function startListening() {
    if (recognition && !isAnalyzing && isStarted && !window.speechSynthesis.speaking) {
        try { 
            recognition.start(); 
            playMicActiveBeep();
        } catch (e) {}
    }
}

function stopListening() {
    if (recognition) {
        try { recognition.abort(); } catch (e) {}
    }
}

// Hilfsfunktion: Bereinigt die Spracheingabe vom Such-Befehl
function extractSearchTarget(command) {
    return command
        .replace(/\b(suche|finde|nach|das|die|den|dem|ein|eine|einen|meine|mein|meinen)\b/g, '')
        .trim();
}

// 5. BEFEHLE VERARBEITEN
function handleCommand(command) {
    // Falls auf die Nennung des Such-Gegenstands gewartet wird
    if (isWaitingForSearchTarget) {
        clearTimeout(searchTimeoutTimer);
        isWaitingForSearchTarget = false;
        
        const cleanTarget = extractSearchTarget(command);
        const finalTarget = cleanTarget.length > 0 ? cleanTarget : command;
        
        triggerAnalysis('search', finalTarget);
        return;
    }

    // Stopp-Befehl
    if (command.includes('stopp') || command.includes('halt') || command.includes('ruhe')) {
        stopAllOutput();
        return;
    }

    // Rechtliche Seiten
    if (command.includes('impressum')) {
        speak("Öffne Impressum.", () => { window.location.href = 'impressum.html'; });
        return;
    }
    if (command.includes('datenschutz')) {
        speak("Öffne Datenschutzerklärung.", () => { window.location.href = 'datenschutz.html'; });
        return;
    }

    // Such-Befehl
    if (command.includes('suche') || command.includes('finde')) {
        const target = extractSearchTarget(command);
        if (target.length > 0) {
            triggerAnalysis('search', target);
        } else {
            isWaitingForSearchTarget = true;
            
            searchTimeoutTimer = setTimeout(() => {
                if (isWaitingForSearchTarget) {
                    isWaitingForSearchTarget = false;
                    speak("Kein Suchbegriff erkannt.", () => startListening());
                }
            }, 10000);

            speak("Was soll ich für dich suchen?", () => {
                startListening();
            });
        }
        return;
    }

    // Hilfe-Befehl
    if (command.includes('hilfe') || command.includes('befehle') || command.includes('optionen')) {
        playBeep(600, 0.1);
        speak(
            "Mögliche Befehle sind: Text, Farbe, Objekt, Geld, Suche, Licht an, Licht aus, Wiederholen, Impressum, Datenschutz oder Stopp.", 
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
        speak("Nicht verstanden. Sage einen Modus wie Text, Geld oder Suche, oder sage Hilfe für alle Befehle.", () => startListening());
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

// 7. BACKEND ANFRAGE (60 Sekunden Timeout)
async function triggerAnalysis(mode, target = null) {
    if (!navigator.onLine) {
        speak("Keine Internetverbindung verfügbar. Bitte prüfe deine Verbindung.", () => startListening());
        return;
    }

    if (isAnalyzing) return;
    isAnalyzing = true;
    
    playBeep(880, 0.15);
    
    const statusText = mode === 'search' ? `Suche nach ${target}...` : "Analysiere Bild, bitte warten...";
    speak(statusText, null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
        const imageBase64 = captureImageBase64();

        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ imageBase64, mode, target })
        });

        clearTimeout(timeoutId);
        const data = await response.json();

        if (response.ok && data.result) {
            lastResult = data.result;
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
        clearTimeout(timeoutId);
        isAnalyzing = false;

        if (err.name === 'AbortError') {
            speak("Die Analyse hat das Zeitlimit von einer Minute überschritten. Bitte versuche es erneut.", () => startListening());
        } else {
            speak("Verbindungsfehler zum Backend.", () => startListening());
        }
    }
}

// System-Listener
window.addEventListener('offline', () => {
    speak("Internetverbindung unterbrochen.");
});

window.addEventListener('online', () => {
    speak("Internetverbindung wiederhergestellt.", () => startListening());
});

// 8. ABBRUCH-FUNKTION
function stopAllOutput() {
    clearTimeout(searchTimeoutTimer);
    isWaitingForSearchTarget = false;
    stopListening();
    window.speechSynthesis.cancel();
    isAnalyzing = false;
    playBeep(440, 0.2);
    statusBox.textContent = "Angehalten.";
    setTimeout(startListening, 500);
}

// 9. INITIALISIERUNG
async function init() {
    if (isStarted) return;
    isStarted = true;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
        });
        video.srcObject = stream;
        
        speak("SichtAssist bereit. Sage Text, Farbe, Objekt, Geld oder Suche. Für alle Optionen sage Hilfe.", () => {
            startListening();
        });

    } catch (err) {
        console.error("Kamerafehler:", err);
        speak("Kamera-Zugriff verweigert. Bitte tippe einmal auf den Bildschirm.");
        isStarted = false;
    }
}

// EVENT LISTENER
window.addEventListener('DOMContentLoaded', () => {
    init();
});

document.body.addEventListener('click', (e) => {
    if (e.target.closest('.legal-footer')) return;

    if (!isStarted) {
        init();
    } else if (window.speechSynthesis.speaking) {
        stopAllOutput();
    }
});

document.getElementById('btnText').addEventListener('click', (e) => { e.stopPropagation(); triggerAnalysis('text'); });
document.getElementById('btnColor').addEventListener('click', (e) => { e.stopPropagation(); triggerAnalysis('color'); });
document.getElementById('btnObject').addEventListener('click', (e) => { e.stopPropagation(); triggerAnalysis('object'); });
document.getElementById('btnCurrency').addEventListener('click', (e) => { e.stopPropagation(); triggerAnalysis('currency'); });