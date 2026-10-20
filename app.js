const BACKEND_URL = "https://sichtassist-backend.onrender.com/api/analyze";

const video = document.getElementById('cameraFeed');
const statusBox = document.getElementById('appStatus');
let isAnalyzing = false;
let isStarted = false;
let isWaitingForSearchTarget = false;
let isWaitingForCountTarget = false;
let searchTimeoutTimer = null;
let micInactivityTimer = null; 
let isMicActive = false; 
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

function playMicDeactiveBeep() {
    playBeep(440, 0.12); 
}

// 2. SPRACHAUSGABE (TTS)
function speak(text, callback) {
    if (recognition) {
        try { recognition.stop(); } catch (e) {}
    }
    
    window.speechSynthesis.cancel();
    
    setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'de-DE';
        utterance.rate = 0.9; 
        
        utterance.onend = () => { 
            if (callback) setTimeout(callback, 300); 
        };
        
        utterance.onerror = (e) => { 
            console.error("TTS Fehler:", e); 
            if (callback) setTimeout(callback, 300); 
        };
        
        statusBox.textContent = text;
        window.speechSynthesis.speak(utterance);
    }, 150);
}

// 3. TASCHENLAMPE SCHALTEN (Hilfsfunktion)
async function setTorch(enable) {
    if (video.srcObject) {
        const tracks = video.srcObject.getVideoTracks();
        if (tracks.length > 0) {
            const track = tracks[0];
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            if (capabilities.torch) {
                try {
                    await track.applyConstraints({ advanced: [{ torch: enable }] });
                    return true;
                } catch (e) {
                    console.warn("Taschenlampe konnte nicht geschaltet werden:", e);
                }
            }
        }
    }
    return false;
}

// 4. SPRACHERKENNUNG (STT) STEUERUNG
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'de-DE';
    recognition.continuous = true;

    recognition.onresult = (event) => {
        const lastIndex = event.results.length - 1;
        const command = event.results[lastIndex][0].transcript.toLowerCase();
        
        clearTimeout(micInactivityTimer);
        micInactivityTimer = null;
        
        if (recognition) {
            try { recognition.stop(); } catch (e) {}
        }
        
        handleCommand(command);
    };

    recognition.onerror = (event) => {
        if (event.error !== 'no-speech' && isStarted && !window.speechSynthesis.speaking) {
            setTimeout(startListening, 1000);
        }
    };
    
    recognition.onend = () => {
        isMicActive = false;
        if (isStarted && micInactivityTimer && !window.speechSynthesis.speaking && !isAnalyzing) {
            try { recognition.start(); } catch (e) {}
        }
    };
}

function startListening() {
    if (recognition && !isAnalyzing && isStarted && !window.speechSynthesis.speaking) {
        try { 
            recognition.start(); 
            if (!isMicActive) {
                playMicActiveBeep();
                isMicActive = true;
            }
            resetMicTimeout(); 
        } catch (e) {}
    }
}

function stopListening(playDeactiveSound = false) {
    clearTimeout(micInactivityTimer);
    micInactivityTimer = null;
    
    if (recognition) {
        try { recognition.stop(); } catch (e) {}
    }
    
    if (playDeactiveSound && isMicActive) {
        playMicDeactiveBeep();
    }
    isMicActive = false;
}

// 10-Sekunden Inaktivitäts-Timer
function resetMicTimeout() {
    clearTimeout(micInactivityTimer);
    micInactivityTimer = setTimeout(() => {
        clearTimeout(micInactivityTimer);
        micInactivityTimer = null;
        
        if (recognition) {
            try { recognition.stop(); } catch (e) {}
        }
        
        speak("Mikrofon aus. Tippe auf den Bildschirm, um mich wieder zu aktivieren.", () => {
            playMicDeactiveBeep();
            isMicActive = false;
        });
    }, 10000); 
}

// Hilfsfunktionen für Spracheingaben
function extractSearchTarget(command) {
    return command
        .replace(/\b(suche|finde|nach|das|die|den|dem|ein|eine|einen|meine|mein|meinen)\b/g, '')
        .trim();
}

function promptForSearchTarget() {
    isWaitingForSearchTarget = true;
    stopListening(false); 
    
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

function promptForCountTarget() {
    isWaitingForCountTarget = true;
    stopListening(false); 
    
    searchTimeoutTimer = setTimeout(() => {
        if (isWaitingForCountTarget) {
            isWaitingForCountTarget = false;
            speak("Kein Zählobjekt erkannt.", () => startListening());
        }
    }, 10000);

    speak("Was soll ich für dich zählen?", () => {
        startListening(); 
    });
}

// 5. BEFEHLE VERARBEITEN (Inkl. Kombinierte Befehle & Zählen)
function handleCommand(command) {
    // 1. Wenn wir auf ein Suchziel warten
    if (isWaitingForSearchTarget) {
        clearTimeout(searchTimeoutTimer);
        isWaitingForSearchTarget = false;
        const cleanTarget = extractSearchTarget(command);
        triggerAnalysis('search', cleanTarget.length > 0 ? cleanTarget : command);
        return;
    }

    // 2. Wenn wir auf ein Zählobjekt warten
    if (isWaitingForCountTarget) {
        clearTimeout(searchTimeoutTimer);
        isWaitingForCountTarget = false;
        
        // Ignoriere, falls die App fälschlicherweise das Wort "zähle" selbst auffängt
        let cleanTarget = command.replace(/\b(zähle|zählen|wie viele|das|die|den|dem|ein|eine|einen)\b/g, '').trim();
        const finalTarget = cleanTarget.length > 0 ? cleanTarget : command;
        
        triggerAnalysis('count', finalTarget);
        return;
    }

    if (command.includes('stopp') || command.includes('halt') || command.includes('ruhe')) {
        clearTimeout(searchTimeoutTimer);
        clearTimeout(micInactivityTimer);
        micInactivityTimer = null;
        isWaitingForSearchTarget = false;
        isWaitingForCountTarget = false;
        isAnalyzing = false;
        
        if (recognition) {
            try { recognition.stop(); } catch (e) {}
        }

        speak("Mikrofon gestoppt. Tippe auf den Bildschirm zum Aktivieren.", () => {
            playMicDeactiveBeep();
            isMicActive = false;
        });
        return;
    }

    if (command.includes('impressum')) {
        speak("Öffne Impressum.", () => { window.location.href = 'impressum.html'; });
        return;
    }
    if (command.includes('datenschutz')) {
        speak("Öffne Datenschutzerklärung.", () => { window.location.href = 'datenschutz.html'; });
        return;
    }

    // --- SICHERE SUCHE ---
    if (command.includes('suche') || command.includes('finde')) {
        let cleanCommand = command.replace(/suche|finde/g, '');
        const target = extractSearchTarget(cleanCommand);
        if (target.length > 1) { // Mindestens 2 Zeichen, um einzelne Buchstaben-Hänger zu verhindern
            triggerAnalysis('search', target);
        } else {
            promptForSearchTarget();
        }
        return;
    }

    // --- SICHERES ZÄHLEN ---
    if (command.includes('zähle') || command.includes('zählen') || command.includes('wie viele')) {
        let cleanCommand = command.replace(/zähle|zählen|wie viele/g, '');
        const target = extractSearchTarget(cleanCommand);
        if (target.length > 1) { // Mindestens 2 Zeichen (z.B. "Stifte")
            triggerAnalysis('count', target);
        } else {
            promptForCountTarget(); // Nur ausführen, wenn wirklich nur "Zähle" gesagt wurde
        }
        return;
    }

    // Kombinierte Befehle erkennen (z.B. "text und farbe")
    let detectedModes = [];
    if (command.includes('text') || command.includes('lesen')) detectedModes.push('text');
    if (command.includes('farbe')) detectedModes.push('color');
    if (command.includes('objekt') || command.includes('was ist das')) detectedModes.push('object');
    if (command.includes('geld') || command.includes('schein') || command.includes('münze')) detectedModes.push('currency');
    
    if (detectedModes.length > 1) {
        triggerAnalysis(detectedModes.join('+'));
        return;
    }

    if (detectedModes.length === 1) {
        triggerAnalysis(detectedModes[0]);
        return;
    }

    if (command.includes('hilfe') || command.includes('befehle') || command.includes('optionen')) {
        playBeep(600, 0.1);
        speak(
            "Mögliche Befehle sind: Text, Farbe, Objekt, Geld, Zählen, Suche, Wiederholen, Impressum, Datenschutz oder Stopp. Du kannst Befehle auch kombinieren, wie Text und Farbe.", 
            () => startListening()
        );
        return;
    }

    if (command.includes('wiederholen') || command.includes('nochmal')) {
        playBeep(600, 0.1);
        if (lastResult) {
            speak(lastResult, () => startListening());
        } else {
            speak("Keine vorherige Analyse vorhanden.", () => startListening());
        }
        return;
    }

    speak("Nicht verstanden. Sage einen Modus wie Text, Geld, Zählen oder Hilfe für alle Befehle.", () => startListening());
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

// 7. BACKEND ANFRAGE
async function triggerAnalysis(mode, target = null, isRetryWithTorch = false) {
    if (!navigator.onLine) {
        speak("Keine Internetverbindung verfügbar. Bitte prüfe deine Verbindung.", () => startListening());
        return;
    }

    if (isAnalyzing && !isRetryWithTorch) return;
    isAnalyzing = true;
    
    playBeep(880, 0.15);
    
    if (isRetryWithTorch) {
        speak("Bild war zu dunkel. Schalte Licht ein und versuche es erneut...", null);
        await setTorch(true);
        await new Promise(resolve => setTimeout(resolve, 400));
    } else {
        let statusText = "Analysiere Bild, bitte warten...";
        if (mode === 'search') statusText = `Suche nach ${target}...`;
        if (mode === 'count') statusText = `Zähle ${target || 'Objekte'}...`;
        if (mode.includes('+')) statusText = "Führe kombinierte Analyse durch...";
        speak(statusText, null);
    }

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

        if (isRetryWithTorch) {
            await setTorch(false);
        }

        if (response.ok && data.result) {
            if (data.result.includes('[RETRY_WITH_TORCH]') && !isRetryWithTorch) {
                return triggerAnalysis(mode, target, true);
            }

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
        if (isRetryWithTorch) await setTorch(false);
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
    isWaitingForCountTarget = false;
    stopListening(true);
    window.speechSynthesis.cancel();
    setTorch(false);
    isAnalyzing = false;
    statusBox.textContent = "Angehalten.";
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
        
        speak("SichtAssist bereit. Sage Text, Farbe, Objekt, Geld, Zählen oder Suche. Für alle Optionen sage Hilfe.", () => {
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
    } else {
        if (window.speechSynthesis.speaking) {
            stopAllOutput();
        } else {
            startListening();
        }
    }
});

// Disclaimer vorlesen bei Klick / Touch
const disclaimerElement = document.getElementById('disclaimer');
if (disclaimerElement) {
    disclaimerElement.addEventListener('click', (e) => {
        e.stopPropagation(); 
        speak(disclaimerElement.textContent);
    });
}

document.getElementById('btnText').addEventListener('click', (e) => { e.stopPropagation(); triggerAnalysis('text'); });
document.getElementById('btnColor').addEventListener('click', (e) => { e.stopPropagation(); triggerAnalysis('color'); });
document.getElementById('btnObject').addEventListener('click', (e) => { e.stopPropagation(); triggerAnalysis('object'); });
document.getElementById('btnCurrency').addEventListener('click', (e) => { e.stopPropagation(); triggerAnalysis('currency'); });
document.getElementById('btnCount').addEventListener('click', (e) => { 
    e.stopPropagation(); 
    stopListening(false); 
    promptForCountTarget(); 
});
document.getElementById('btnSearch').addEventListener('click', (e) => { 
    e.stopPropagation(); 
    stopListening(false); 
    promptForSearchTarget(); 
});