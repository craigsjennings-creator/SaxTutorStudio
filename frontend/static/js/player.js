/*
 * YourMusicTutorial - Master Playback Engine v2
 *
 * Web Audio's AudioContext clock is the single source of truth.
 * It drives guide audio, metronome, timeline movement and
 * current-note highlighting.
 *
 * The guide sound is still synthesized, but now uses:
 *   - layered oscillators
 *   - harmonic shaping
 *   - low-pass filtering
 *   - breath-like noise
 *   - a gentle vibrato
 *
 * That gives a more sax-like practice sound without requiring
 * external samples yet.
 */

let tutorialNotes = [];
let currentEventIndex = 0;

let audioContext = null;
let guideBus = null;
let metronomeBus = null;
let masterBus = null;

let isPlaying = false;

let playbackStartAudioTime = 0;
let pausedMusicalBeats = 0;

let animationFrame = null;
let scheduledSources = [];

const BASE_BPM = 120;
const COUNT_IN_BEATS = 4;

/*
 * Real Iowa Alto Sax sample bank.
 * These are the 32 WAV files created by split_iowa_alto.py.
 */
const ALTO_SAMPLE_BASE =
    "/static/audio/saxophone/alto/samples/mf/";

const ALTO_SAMPLE_NOTES = [
    "Db3", "D3", "Eb3", "E3", "F3", "Gb3",
    "G3", "Ab3", "A3", "Bb3", "B3",
    "C4", "Db4", "D4", "Eb4", "E4", "F4",
    "Gb4", "G4", "Ab4", "A4", "Bb4", "B4",
    "C5", "Db5", "D5", "Eb5", "E5", "F5",
    "Gb5", "G5", "Ab5"
];

const altoSampleBuffers = new Map();
let altoSamplesLoadingPromise = null;


/* =========================================================
   Audio setup
   ========================================================= */

function ensureAudioContext() {

    if (!audioContext) {

        const AudioContextClass =
            window.AudioContext ||
            window.webkitAudioContext;

        audioContext =
            new AudioContextClass();

        masterBus =
            audioContext.createGain();

        guideBus =
            audioContext.createGain();

        metronomeBus =
            audioContext.createGain();

        guideBus.connect(masterBus);
        metronomeBus.connect(masterBus);
        masterBus.connect(audioContext.destination);

        masterBus.gain.value = 0.9;

        updateAudioControlGains();
    }

    if (audioContext.state === "suspended") {
        audioContext.resume();
    }
}


function getSpeed() {

    const speed =
        document.getElementById("speed");

    return speed
        ? parseFloat(speed.value)
        : 1;
}


function secondsPerBeat() {

    return (
        60 /
        BASE_BPM /
        getSpeed()
    );
}


function updateAudioControlGains() {

    if (!audioContext) {
        return;
    }

    const now =
        audioContext.currentTime;

    const guideEnabled =
        document.getElementById(
            "guide-enabled"
        )?.checked ?? true;

    const metronomeEnabled =
        document.getElementById(
            "metronome-enabled"
        )?.checked ?? true;

    const guideVolume =
        parseFloat(
            document.getElementById(
                "guide-volume"
            )?.value ?? "70"
        ) / 100;

    const metronomeVolume =
        parseFloat(
            document.getElementById(
                "metronome-volume"
            )?.value ?? "55"
        ) / 100;

    guideBus.gain.setTargetAtTime(
        guideEnabled
            ? guideVolume
            : 0,
        now,
        0.01
    );

    metronomeBus.gain.setTargetAtTime(
        metronomeEnabled
            ? metronomeVolume
            : 0,
        now,
        0.01
    );
}


/* =========================================================
   Pitch conversion
   ========================================================= */

const NOTE_TO_SEMITONE = {
    "C": 0,
    "C#": 1,
    "D-": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "E-": 3,
    "Eb": 3,
    "E": 4,
    "F": 5,
    "F#": 6,
    "G-": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "A-": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "B-": 10,
    "Bb": 10,
    "B": 11
};


function noteNameToMidi(noteName) {

    const match =
        String(noteName).match(
            /^([A-G])([#b-]?)(-?\d+)$/
        );

    if (!match) {
        return null;
    }

    const [, letter, accidental, octaveText] =
        match;

    const semitone =
        NOTE_TO_SEMITONE[
            `${letter}${accidental}`
        ];

    if (semitone === undefined) {
        return null;
    }

    const octave =
        parseInt(octaveText, 10);

    return (
        (octave + 1) * 12 +
        semitone
    );
}


function midiToFrequency(midi) {

    return (
        440 *
        Math.pow(
            2,
            (midi - 69) / 12
        )
    );
}


/* =========================================================
   Real Alto Sax sample loading
   ========================================================= */

function normaliseSamplePitch(noteName) {

    const match =
        String(noteName).match(
            /^([A-G])([#b-]?)(-?\d+)$/
        );

    if (!match) {
        return null;
    }

    const [, letter, accidental, octave] =
        match;

    const sharpToFlat = {
        "C#": "Db",
        "D#": "Eb",
        "F#": "Gb",
        "G#": "Ab",
        "A#": "Bb"
    };

    let pitchClass =
        `${letter}${accidental}`;

    /*
     * music21 may represent flats with "-" (e.g. B-4).
     */
    if (accidental === "-") {
        pitchClass = `${letter}b`;
    }

    if (sharpToFlat[pitchClass]) {
        pitchClass =
            sharpToFlat[pitchClass];
    }

    return `${pitchClass}${octave}`;
}


async function loadAudioBuffer(url) {

    const response =
        await fetch(url);

    if (!response.ok) {
        throw new Error(
            `HTTP ${response.status} loading ${url}`
        );
    }

    const bytes =
        await response.arrayBuffer();

    return await audioContext.decodeAudioData(
        bytes
    );
}


async function preloadAltoSamples() {

    ensureAudioContext();

    if (altoSamplesLoadingPromise) {
        return altoSamplesLoadingPromise;
    }

    altoSamplesLoadingPromise =
        Promise.all(
            ALTO_SAMPLE_NOTES.map(
                async noteName => {

                    try {

                        const buffer =
                            await loadAudioBuffer(
                                `${ALTO_SAMPLE_BASE}${noteName}.wav`
                            );

                        altoSampleBuffers.set(
                            noteName,
                            buffer
                        );

                    } catch (error) {

                        console.warn(
                            `Could not preload Alto sample ${noteName}:`,
                            error
                        );
                    }
                }
            )
        ).then(() => {

            console.log(
                `Loaded ${altoSampleBuffers.size}/${ALTO_SAMPLE_NOTES.length} real Alto Sax samples.`
            );

            return altoSampleBuffers.size;
        });

    return altoSamplesLoadingPromise;
}


function scheduleRealSaxSample(
    noteName,
    startTime,
    durationSeconds
) {

    const samplePitch =
        normaliseSamplePitch(noteName);

    const buffer =
        samplePitch
            ? altoSampleBuffers.get(
                samplePitch
            )
            : null;

    if (!buffer) {
        return false;
    }

    const source =
        audioContext.createBufferSource();

    source.buffer = buffer;

    const envelope =
        audioContext.createGain();

    /*
     * Keep the natural recorded attack.
     * Fade the end to avoid a hard cut when MusicXML asks
     * for a shorter duration than the original recording.
     */
    const attack = 0.008;
    const release =
        Math.min(
            0.08,
            Math.max(
                0.025,
                durationSeconds * 0.12
            )
        );

    envelope.gain.setValueAtTime(
        0.0001,
        startTime
    );

    envelope.gain.linearRampToValueAtTime(
        0.9,
        startTime + attack
    );

    const releaseStart =
        Math.max(
            startTime + attack,
            startTime +
            durationSeconds -
            release
        );

    envelope.gain.setValueAtTime(
        0.9,
        releaseStart
    );

    envelope.gain.linearRampToValueAtTime(
        0.0001,
        startTime +
        durationSeconds
    );

    source.connect(envelope);
    envelope.connect(guideBus);

    source.start(
        startTime,
        0,
        Math.min(
            buffer.duration,
            durationSeconds + 0.02
        )
    );

    source.stop(
        startTime +
        Math.min(
            buffer.duration,
            durationSeconds + 0.02
        )
    );

    scheduledSources.push(source);

    return true;
}


/* =========================================================
   More sax-like guide tone
   ========================================================= */

function stopScheduledAudio() {

    scheduledSources.forEach(source => {

        try {
            source.stop();
        } catch (error) {
            // Already stopped.
        }

    });

    scheduledSources = [];
}


function createBreathNoise(
    startTime,
    durationSeconds
) {

    const sampleRate =
        audioContext.sampleRate;

    const frameCount =
        Math.max(
            1,
            Math.floor(
                sampleRate *
                Math.min(
                    durationSeconds + 0.1,
                    6
                )
            )
        );

    const buffer =
        audioContext.createBuffer(
            1,
            frameCount,
            sampleRate
        );

    const data =
        buffer.getChannelData(0);

    for (let i = 0; i < frameCount; i++) {

        /*
         * Very low-level noise gives the note a little
         * breath/air without overwhelming the pitch.
         */
        data[i] =
            (Math.random() * 2 - 1) *
            0.16;
    }

    const source =
        audioContext.createBufferSource();

    source.buffer = buffer;

    const filter =
        audioContext.createBiquadFilter();

    filter.type = "bandpass";
    filter.frequency.value = 2300;
    filter.Q.value = 0.7;

    const gain =
        audioContext.createGain();

    gain.gain.setValueAtTime(
        0.0001,
        startTime
    );

    gain.gain.linearRampToValueAtTime(
        0.06,
        startTime + 0.03
    );

    gain.gain.setValueAtTime(
        0.05,
        Math.max(
            startTime + 0.03,
            startTime + durationSeconds - 0.05
        )
    );

    gain.gain.linearRampToValueAtTime(
        0.0001,
        startTime + durationSeconds
    );

    source.connect(filter);
    filter.connect(gain);
    gain.connect(guideBus);

    source.start(startTime);
    source.stop(
        startTime +
        durationSeconds +
        0.02
    );

    scheduledSources.push(source);
}


function scheduleSynthGuideTone(
    noteName,
    startTime,
    durationSeconds
) {

    const midi =
        noteNameToMidi(noteName);

    if (midi === null) {
        return;
    }

    const frequency =
        midiToFrequency(midi);

    const noteGain =
        audioContext.createGain();

    const filter =
        audioContext.createBiquadFilter();

    filter.type = "lowpass";

    /*
     * Keep low notes warm and allow more brightness
     * as pitch rises.
     */
    filter.frequency.value =
        Math.min(
            5200,
            Math.max(
                1800,
                frequency * 8
            )
        );

    filter.Q.value = 1.2;

    noteGain.connect(filter);
    filter.connect(guideBus);

    const attack = 0.035;
    const release =
        Math.min(
            0.12,
            Math.max(
                0.05,
                durationSeconds * 0.12
            )
        );

    const sustainLevel = 0.24;

    noteGain.gain.setValueAtTime(
        0.0001,
        startTime
    );

    noteGain.gain.exponentialRampToValueAtTime(
        sustainLevel,
        startTime + attack
    );

    const releaseStart =
        Math.max(
            startTime + attack,
            startTime +
            durationSeconds -
            release
        );

    noteGain.gain.setValueAtTime(
        sustainLevel,
        releaseStart
    );

    noteGain.gain.exponentialRampToValueAtTime(
        0.0001,
        startTime +
        durationSeconds
    );

    /*
     * Fundamental plus two harmonics.
     * The mix is intentionally restrained so it stays
     * useful as a guide tone rather than becoming harsh.
     */
    const partials = [
        {
            multiplier: 1,
            type: "sawtooth",
            level: 0.58
        },
        {
            multiplier: 2,
            type: "sine",
            level: 0.21
        },
        {
            multiplier: 3,
            type: "sine",
            level: 0.09
        }
    ];

    const vibrato =
        audioContext.createOscillator();

    const vibratoGain =
        audioContext.createGain();

    vibrato.type = "sine";
    vibrato.frequency.value = 5.2;

    /*
     * About +/- 4 cents-ish depending on frequency.
     * Kept subtle for beginner practice.
     */
    vibratoGain.gain.value =
        frequency * 0.0022;

    vibrato.connect(vibratoGain);

    partials.forEach(partial => {

        const osc =
            audioContext.createOscillator();

        const partialGain =
            audioContext.createGain();

        osc.type = partial.type;

        osc.frequency.value =
            frequency *
            partial.multiplier;

        partialGain.gain.value =
            partial.level;

        /*
         * Vibrato is most useful on the fundamental.
         */
        if (partial.multiplier === 1) {
            vibratoGain.connect(
                osc.frequency
            );
        }

        osc.connect(partialGain);
        partialGain.connect(noteGain);

        osc.start(startTime);

        osc.stop(
            startTime +
            durationSeconds +
            0.03
        );

        scheduledSources.push(osc);
    });

    vibrato.start(startTime);
    vibrato.stop(
        startTime +
        durationSeconds +
        0.03
    );

    scheduledSources.push(vibrato);

    createBreathNoise(
        startTime,
        durationSeconds
    );
}


/* =========================================================
   Metronome
   ========================================================= */

function scheduleMetronomeClick(
    when,
    strong = false
) {

    const osc =
        audioContext.createOscillator();

    const gain =
        audioContext.createGain();

    osc.type = "square";

    osc.frequency.value =
        strong ? 1250 : 900;

    gain.gain.setValueAtTime(
        strong ? 0.18 : 0.11,
        when
    );

    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        when + 0.055
    );

    osc.connect(gain);
    gain.connect(metronomeBus);

    osc.start(when);
    osc.stop(when + 0.06);

    scheduledSources.push(osc);
}


function scheduleMetronomeFromBeat(
    startBeat,
    includeCountIn
) {

    const secPerBeat =
        secondsPerBeat();

    const totalBeats =
        getTotalBeats();

    if (includeCountIn) {

        for (
            let beat = 0;
            beat < COUNT_IN_BEATS;
            beat++
        ) {

            scheduleMetronomeClick(
                audioContext.currentTime +
                (beat * secPerBeat),
                beat === 0
            );
        }
    }

    /*
     * Schedule clicks on each musical quarter beat.
     */
    const firstBeat =
        Math.ceil(startBeat);

    for (
        let beat = firstBeat;
        beat <= Math.ceil(totalBeats);
        beat++
    ) {

        const when =
            playbackStartAudioTime +
            (beat * secPerBeat);

        if (
            when <
            audioContext.currentTime - 0.01
        ) {
            continue;
        }

        /*
         * Accent every fourth beat for orientation.
         */
        scheduleMetronomeClick(
            when,
            beat % 4 === 0
        );
    }
}


/* =========================================================
   Count-in + timeline UI
   ========================================================= */

function setCountInDisplay(value) {

    const overlay =
        document.getElementById(
            "count-in-overlay"
        );

    if (!overlay) {
        return;
    }

    if (value === null) {

        overlay.textContent = "";
        overlay.classList.remove(
            "visible"
        );

        return;
    }

    overlay.textContent = value;
    overlay.classList.add("visible");
}


function highlightEvent(index) {

    currentEventIndex = index;

    document
        .querySelectorAll(".detected-note")
        .forEach((button, buttonIndex) => {

            button.classList.toggle(
                "active",
                buttonIndex === index
            );

        });
}


function currentMusicalBeat() {

    if (!isPlaying) {
        return pausedMusicalBeats;
    }

    const elapsedSeconds =
        audioContext.currentTime -
        playbackStartAudioTime;

    return (
        elapsedSeconds /
        secondsPerBeat()
    );
}


function getTotalBeats() {

    if (!tutorialNotes.length) {
        return 0;
    }

    return Math.max(
        ...tutorialNotes.map(note =>
            note.offset +
            note.duration
        )
    );
}


function updateTimelineAndHighlight() {

    if (!isPlaying) {
        return;
    }

    const beat =
        currentMusicalBeat();

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(
            Math.max(0, beat)
        );
    }

    if (beat < 0) {

        const countBeat =
            Math.floor(
                beat + COUNT_IN_BEATS
            );

        const number =
            Math.max(
                1,
                Math.min(
                    COUNT_IN_BEATS,
                    countBeat + 1
                )
            );

        setCountInDisplay(number);

        animationFrame =
            requestAnimationFrame(
                updateTimelineAndHighlight
            );

        return;
    }

    setCountInDisplay(null);

    let activeIndex = -1;

    for (
        let i = 0;
        i < tutorialNotes.length;
        i++
    ) {

        const note =
            tutorialNotes[i];

        const start =
            note.offset;

        const end =
            note.offset +
            note.duration;

        if (
            beat >= start &&
            beat < end
        ) {
            activeIndex = i;
            break;
        }
    }

    if (activeIndex >= 0) {
        highlightEvent(activeIndex);
    }

    if (beat >= getTotalBeats()) {

        finishPlayback();
        return;
    }

    animationFrame =
        requestAnimationFrame(
            updateTimelineAndHighlight
        );
}


/* =========================================================
   Guide scheduling
   ========================================================= */

function scheduleGuideFromBeat(startBeat) {

    const secPerBeat =
        secondsPerBeat();

    tutorialNotes.forEach(note => {

        if (
            note.type === "rest" ||
            note.pitch === "REST"
        ) {
            return;
        }

        const noteEndBeat =
            note.offset +
            note.duration;

        if (noteEndBeat <= startBeat) {
            return;
        }

        const effectiveStartBeat =
            Math.max(
                note.offset,
                startBeat
            );

        const remainingDurationBeats =
            noteEndBeat -
            effectiveStartBeat;

        const startTime =
            playbackStartAudioTime +
            (effectiveStartBeat *
            secPerBeat);

        const durationSeconds =
            remainingDurationBeats *
            secPerBeat;

        const usedRealSample =
            scheduleRealSaxSample(
                note.pitch,
                startTime,
                durationSeconds
            );

        /*
         * Outside the Iowa sample range, or if a WAV failed
         * to load, retain the existing synthesized guide so
         * the tutorial never becomes silent.
         */
        if (!usedRealSample) {
            scheduleSynthGuideTone(
                note.pitch,
                startTime,
                durationSeconds
            );
        }
    });
}


/* =========================================================
   Playback controls
   ========================================================= */

async function startPlayback() {

    if (!tutorialNotes.length) {
        return;
    }

    if (isPlaying) {
        return;
    }

    ensureAudioContext();
    updateAudioControlGains();

    /*
     * First play waits for the real sax bank to be decoded.
     * Subsequent plays use the browser's cached AudioBuffers.
     */
    await preloadAltoSamples();

    stopScheduledAudio();

    const secPerBeat =
        secondsPerBeat();

    const startingFresh =
        pausedMusicalBeats <= 0.0001;

    const countInDuration =
        startingFresh
            ? COUNT_IN_BEATS *
              secPerBeat
            : 0;

    isPlaying = true;

    const playButton =
        document.getElementById(
            "play-button"
        );

    if (playButton) {
        playButton.textContent =
            "⏸ Pause";
    }

    playbackStartAudioTime =
        audioContext.currentTime +
        countInDuration -
        (pausedMusicalBeats *
        secPerBeat);

    scheduleGuideFromBeat(
        pausedMusicalBeats
    );

    scheduleMetronomeFromBeat(
        pausedMusicalBeats,
        startingFresh
    );

    animationFrame =
        requestAnimationFrame(
            updateTimelineAndHighlight
        );
}


function pausePlayback() {

    if (!isPlaying) {
        return;
    }

    pausedMusicalBeats =
        Math.max(
            0,
            currentMusicalBeat()
        );

    isPlaying = false;

    stopScheduledAudio();

    if (animationFrame) {

        cancelAnimationFrame(
            animationFrame
        );

        animationFrame = null;
    }

    setCountInDisplay(null);

    const playButton =
        document.getElementById(
            "play-button"
        );

    if (playButton) {
        playButton.textContent =
            "▶ Play";
    }
}


function finishPlayback() {

    isPlaying = false;

    stopScheduledAudio();

    if (animationFrame) {

        cancelAnimationFrame(
            animationFrame
        );

        animationFrame = null;
    }

    pausedMusicalBeats = 0;

    setCountInDisplay(null);

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(0);
    }

    highlightEvent(0);

    const playButton =
        document.getElementById(
            "play-button"
        );

    if (playButton) {
        playButton.textContent =
            "▶ Play";
    }
}


function togglePlayback() {

    if (isPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
}


function seekToEvent(index) {

    if (!tutorialNotes.length) {
        return;
    }

    if (isPlaying) {
        pausePlayback();
    }

    currentEventIndex =
        Math.max(
            0,
            Math.min(
                tutorialNotes.length - 1,
                index
            )
        );

    pausedMusicalBeats =
        tutorialNotes[
            currentEventIndex
        ].offset;

    highlightEvent(currentEventIndex);

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(
            pausedMusicalBeats
        );
    }
}


function previousNote() {
    seekToEvent(currentEventIndex - 1);
}


function nextNote() {
    seekToEvent(currentEventIndex + 1);
}


/* =========================================================
   Public loader
   ========================================================= */

function loadTutorialPlayer(notes) {

    tutorialNotes = notes;

    currentEventIndex = 0;
    pausedMusicalBeats = 0;

    stopScheduledAudio();

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(0);
    }

    highlightEvent(0);

    /*
     * If the browser has already created an AudioContext,
     * begin warming the sample cache as soon as a tutorial loads.
     */
    if (audioContext) {
        preloadAltoSamples();
    }
}


/* =========================================================
   UI wiring
   ========================================================= */

function wireAudioControls() {

    const pairs = [
        {
            slider: "guide-volume",
            output: "guide-volume-value"
        },
        {
            slider: "metronome-volume",
            output: "metronome-volume-value"
        }
    ];

    pairs.forEach(pair => {

        const slider =
            document.getElementById(
                pair.slider
            );

        const output =
            document.getElementById(
                pair.output
            );

        slider?.addEventListener(
            "input",
            () => {

                if (output) {
                    output.textContent =
                        `${slider.value}%`;
                }

                updateAudioControlGains();
            }
        );
    });

    document
        .getElementById("guide-enabled")
        ?.addEventListener(
            "change",
            updateAudioControlGains
        );

    document
        .getElementById(
            "metronome-enabled"
        )
        ?.addEventListener(
            "change",
            updateAudioControlGains
        );
}


document.addEventListener(
    "DOMContentLoaded",
    () => {

        document
            .getElementById(
                "play-button"
            )
            ?.addEventListener(
                "click",
                togglePlayback
            );

        document
            .getElementById(
                "previous-note"
            )
            ?.addEventListener(
                "click",
                previousNote
            );

        document
            .getElementById(
                "next-note"
            )
            ?.addEventListener(
                "click",
                nextNote
            );

        document
            .getElementById("speed")
            ?.addEventListener(
                "change",
                () => {

                    /*
                     * Reschedule against the master audio clock
                     * whenever practice speed changes.
                     */
                    if (isPlaying) {
                        pausePlayback();
                    }

                }
            );

        wireAudioControls();

    }
);


window.loadTutorialPlayer =
    loadTutorialPlayer;
