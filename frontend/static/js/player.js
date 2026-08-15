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

let loopHasCountedIn = false;
let timelineLoopClickStage = "start";

let timelineDragActive = false;
let timelineDragMoved = false;
let timelineDragStartX = 0;
let timelineDragStartBeat = 0;

let loopDrawActive = false;
let loopDrawStartIndex = null;
let loopDrawCurrentIndex = null;
let loopDrawPointerId = null;

let loopDrawPointerX = 0;
let loopDrawPointerY = 0;
let loopAutoScrollDirection = 0;
let loopAutoScrollFrame = null;
let loopAutoScrollLastTime = 0;

const LOOP_EDGE_SCROLL_ZONE = 80;
const LOOP_AUTO_SCROLL_BEATS_PER_SECOND = 3.0;

const TIMELINE_DRAG_THRESHOLD = 6;

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
    includeCountIn,
    endBeat = null
) {

    const secPerBeat =
        secondsPerBeat();

    const totalBeats =
        endBeat ?? getTotalBeats();

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
   Practice loop
   ========================================================= */

function getPlayableNoteIndexes() {

    return tutorialNotes
        .map((note, index) => ({
            note,
            index
        }))
        .filter(item =>
            item.note.type !== "rest" &&
            item.note.pitch !== "REST"
        );
}


function populateLoopSelectors() {

    const startSelect =
        document.getElementById("loop-start");

    const endSelect =
        document.getElementById("loop-end");

    if (!startSelect || !endSelect) {
        return;
    }

    startSelect.innerHTML = "";
    endSelect.innerHTML = "";

    const playable =
        getPlayableNoteIndexes();

    playable.forEach((item, position) => {

        const label =
            `${position + 1}. ${item.note.pitch}`;

        const startOption =
            document.createElement("option");

        startOption.value =
            String(item.index);

        startOption.textContent =
            label;

        const endOption =
            document.createElement("option");

        endOption.value =
            String(item.index);

        endOption.textContent =
            label;

        startSelect.appendChild(
            startOption
        );

        endSelect.appendChild(
            endOption
        );
    });

    if (playable.length) {

        startSelect.value =
            String(playable[0].index);

        endSelect.value =
            String(
                playable[
                    Math.min(
                        playable.length - 1,
                        3
                    )
                ].index
            );
    }

    refreshTimelineLoopHighlight();
}


function isLoopEnabled() {

    return (
        document.getElementById(
            "loop-enabled"
        )?.checked ?? false
    );
}


function getLoopBounds() {

    if (!isLoopEnabled()) {
        return {
            startIndex: 0,
            endIndex:
                Math.max(
                    0,
                    tutorialNotes.length - 1
                ),
            startBeat: 0,
            endBeat: getTotalBeats()
        };
    }

    const startSelect =
        document.getElementById(
            "loop-start"
        );

    const endSelect =
        document.getElementById(
            "loop-end"
        );

    let startIndex =
        parseInt(
            startSelect?.value ?? "0",
            10
        );

    let endIndex =
        parseInt(
            endSelect?.value ??
            String(startIndex),
            10
        );

    if (endIndex < startIndex) {

        const temp = startIndex;
        startIndex = endIndex;
        endIndex = temp;
    }

    const startNote =
        tutorialNotes[startIndex];

    const endNote =
        tutorialNotes[endIndex];

    return {
        startIndex,
        endIndex,
        startBeat:
            startNote?.offset ?? 0,
        endBeat:
            (endNote?.offset ?? 0) +
            (endNote?.duration ?? 0)
    };
}


function refreshTimelineLoopHighlight() {

    const selectableItems =
        document.querySelectorAll(
            ".timeline-note[data-note-index], " +
            ".finger-bar[data-note-index]"
        );

    selectableItems.forEach(item => {

        item.classList.remove(
            "loop-start",
            "loop-end",
            "loop-selected"
        );
    });

    if (!isLoopEnabled()) {
        return;
    }

    const bounds =
        getLoopBounds();

    selectableItems.forEach(item => {

        const index =
            parseInt(
                item.dataset.noteIndex ?? "-1",
                10
            );

        if (
            index >= bounds.startIndex &&
            index <= bounds.endIndex
        ) {
            item.classList.add(
                "loop-selected"
            );
        }

        if (index === bounds.startIndex) {
            item.classList.add(
                "loop-start"
            );
        }

        if (index === bounds.endIndex) {
            item.classList.add(
                "loop-end"
            );
        }
    });
}


function setLoopRange(
    startIndex,
    endIndex
) {

    const startSelect =
        document.getElementById(
            "loop-start"
        );

    const endSelect =
        document.getElementById(
            "loop-end"
        );

    if (!startSelect || !endSelect) {
        return;
    }

    if (endIndex < startIndex) {
        [startIndex, endIndex] =
            [endIndex, startIndex];
    }

    startSelect.value =
        String(startIndex);

    endSelect.value =
        String(endIndex);

    loopHasCountedIn = false;

    const bounds =
        getLoopBounds();

    pausedMusicalBeats =
        bounds.startBeat;

    highlightEvent(
        bounds.startIndex
    );

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(
            bounds.startBeat
        );
    }

    refreshTimelineLoopHighlight();
}


function handleTimelineLoopClick(
    noteIndex
) {

    if (shouldSuppressTimelineClick()) {
        return;
    }

    if (!isLoopEnabled()) {
        return;
    }

    /*
     * A simple tap/click still supports the existing
     * start-then-end selection workflow.
     */

    const playableIndexes =
        getPlayableNoteIndexes()
            .map(item => item.index);

    if (!playableIndexes.includes(noteIndex)) {
        return;
    }

    const startSelect =
        document.getElementById(
            "loop-start"
        );

    const endSelect =
        document.getElementById(
            "loop-end"
        );

    if (!startSelect || !endSelect) {
        return;
    }

    if (timelineLoopClickStage === "start") {

        startSelect.value =
            String(noteIndex);

        endSelect.value =
            String(noteIndex);

        timelineLoopClickStage =
            "end";

    } else {

        const startIndex =
            parseInt(
                startSelect.value,
                10
            );

        setLoopRange(
            startIndex,
            noteIndex
        );

        timelineLoopClickStage =
            "start";

        return;
    }

    setLoopRange(
        noteIndex,
        noteIndex
    );
}


function restartLoopCycle() {

    const bounds =
        getLoopBounds();

    stopScheduledAudio();

    pausedMusicalBeats =
        bounds.startBeat;

    playbackStartAudioTime =
        audioContext.currentTime -
        (bounds.startBeat *
        secondsPerBeat());

    scheduleGuideFromBeat(
        bounds.startBeat,
        bounds.endBeat
    );

    scheduleMetronomeFromBeat(
        bounds.startBeat,
        false,
        bounds.endBeat
    );

    highlightEvent(
        bounds.startIndex
    );

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(
            bounds.startBeat
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

    const playbackEnd =
        isLoopEnabled()
            ? getLoopBounds().endBeat
            : getTotalBeats();

    if (beat >= playbackEnd) {

        if (isLoopEnabled()) {

            restartLoopCycle();

            animationFrame =
                requestAnimationFrame(
                    updateTimelineAndHighlight
                );

            return;
        }

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

function scheduleGuideFromBeat(
    startBeat,
    endBeat = null
) {

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

        if (
            endBeat !== null &&
            note.offset >= endBeat
        ) {
            return;
        }

        const effectiveStartBeat =
            Math.max(
                note.offset,
                startBeat
            );

        const effectiveEndBeat =
            endBeat === null
                ? noteEndBeat
                : Math.min(
                    noteEndBeat,
                    endBeat
                );

        const remainingDurationBeats =
            effectiveEndBeat -
            effectiveStartBeat;

        if (remainingDurationBeats <= 0) {
            return;
        }

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

    const bounds =
        getLoopBounds();

    if (
        isLoopEnabled() &&
        (
            pausedMusicalBeats <
                bounds.startBeat ||
            pausedMusicalBeats >=
                bounds.endBeat
        )
    ) {
        pausedMusicalBeats =
            bounds.startBeat;
    }

    const startingFresh =
        isLoopEnabled()
            ? !loopHasCountedIn
            : pausedMusicalBeats <= 0.0001;

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

    const playbackEnd =
        isLoopEnabled()
            ? bounds.endBeat
            : null;

    scheduleGuideFromBeat(
        pausedMusicalBeats,
        playbackEnd
    );

    scheduleMetronomeFromBeat(
        pausedMusicalBeats,
        startingFresh,
        playbackEnd
    );

    if (
        startingFresh &&
        isLoopEnabled()
    ) {
        loopHasCountedIn = true;
    }

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
    loopHasCountedIn = false;

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

function applyScorecardPracticeRequest() {

    const params =
        new URLSearchParams(
            window.location.search
        );

    if (
        params.get(
            "practiceFromScorecard"
        ) !== "1"
    ) {
        return;
    }

    const requestedStartBeat =
        parseFloat(
            params.get(
                "loopStartBeat"
            )
        );

    const requestedEndBeat =
        parseFloat(
            params.get(
                "loopEndBeat"
            )
        );

    if (
        !Number.isFinite(
            requestedStartBeat
        ) ||
        !Number.isFinite(
            requestedEndBeat
        )
    ) {
        return;
    }

    const playable =
        getPlayableNoteIndexes();

    if (!playable.length) {
        return;
    }

    let startItem =
        playable[0];

    let endItem =
        playable[
            playable.length - 1
        ];

    let startDistance =
        Infinity;

    let endDistance =
        Infinity;

    playable.forEach(item => {

        const note =
            item.note;

        const noteStart =
            note.offset;

        const noteEnd =
            note.offset +
            note.duration;

        const candidateStartDistance =
            Math.abs(
                noteStart -
                requestedStartBeat
            );

        const candidateEndDistance =
            Math.abs(
                noteEnd -
                requestedEndBeat
            );

        if (
            candidateStartDistance <
            startDistance
        ) {
            startDistance =
                candidateStartDistance;

            startItem =
                item;
        }

        if (
            candidateEndDistance <
            endDistance
        ) {
            endDistance =
                candidateEndDistance;

            endItem =
                item;
        }
    });

    const loopEnabled =
        document.getElementById(
            "loop-enabled"
        );

    const loopStart =
        document.getElementById(
            "loop-start"
        );

    const loopEnd =
        document.getElementById(
            "loop-end"
        );

    if (loopEnabled) {
        loopEnabled.checked =
            true;
    }

    if (loopStart) {
        loopStart.disabled =
            false;
    }

    if (loopEnd) {
        loopEnd.disabled =
            false;
    }

    setLoopRange(
        startItem.index,
        endItem.index
    );

    timelineLoopClickStage =
        "start";

    loopHasCountedIn =
        false;

    refreshTimelineLoopHighlight();

    const requestedSpeed =
        params.get(
            "speed"
        );

    const speedSelect =
        document.getElementById(
            "speed"
        );

    if (
        requestedSpeed &&
        speedSelect
    ) {
        speedSelect.value =
            requestedSpeed;
    }

    pausedMusicalBeats =
        getLoopBounds().startBeat;

    if (
        window
            .setTimelineBeatPosition
    ) {
        window.setTimelineBeatPosition(
            pausedMusicalBeats
        );
    }

    window.history.replaceState(
        {},
        document.title,
        window.location.pathname
    );
}


function loadTutorialPlayer(notes) {

    tutorialNotes = notes;

    currentEventIndex = 0;
    pausedMusicalBeats = 0;

    stopScheduledAudio();

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(0);
    }

    highlightEvent(0);

    loopHasCountedIn = false;
    timelineLoopClickStage = "start";
    populateLoopSelectors();

    applyScorecardPracticeRequest();

    /*
     * If the browser has already created an AudioContext,
     * begin warming the sample cache as soon as a tutorial loads.
     */
    if (audioContext) {
        preloadAltoSamples();
    }
}


/* =========================================================
   Drag-to-draw loop selection
   ========================================================= */

function getSelectableNoteIndexFromPoint(
    clientX,
    clientY
) {

    const element =
        document.elementFromPoint(
            clientX,
            clientY
        );

    const selectable =
        element?.closest(
            ".loop-selectable[data-note-index]"
        );

    if (!selectable) {
        return null;
    }

    const index =
        parseInt(
            selectable.dataset.noteIndex ?? "",
            10
        );

    return Number.isFinite(index)
        ? index
        : null;
}


function nearestPlayableIndex(index) {

    const playable =
        getPlayableNoteIndexes()
            .map(item => item.index);

    if (!playable.length) {
        return null;
    }

    if (playable.includes(index)) {
        return index;
    }

    let nearest =
        playable[0];

    let distance =
        Math.abs(
            nearest - index
        );

    playable.forEach(candidate => {

        const candidateDistance =
            Math.abs(
                candidate - index
            );

        if (candidateDistance < distance) {
            nearest = candidate;
            distance = candidateDistance;
        }
    });

    return nearest;
}


function previewLoopRange(
    startIndex,
    endIndex
) {

    document
        .querySelectorAll(
            ".loop-selectable[data-note-index]"
        )
        .forEach(item => {

            item.classList.remove(
                "loop-preview"
            );
        });

    if (
        startIndex === null ||
        endIndex === null
    ) {
        return;
    }

    const minIndex =
        Math.min(
            startIndex,
            endIndex
        );

    const maxIndex =
        Math.max(
            startIndex,
            endIndex
        );

    document
        .querySelectorAll(
            ".loop-selectable[data-note-index]"
        )
        .forEach(item => {

            const index =
                parseInt(
                    item.dataset.noteIndex ?? "-1",
                    10
                );

            if (
                index >= minIndex &&
                index <= maxIndex
            ) {
                item.classList.add(
                    "loop-preview"
                );
            }
        });
}


function clearLoopPreview() {

    document
        .querySelectorAll(
            ".loop-preview"
        )
        .forEach(item =>
            item.classList.remove(
                "loop-preview"
            )
        );
}


function getNearestTimelineNoteIndexByX(
    clientX
) {

    const notes =
        Array.from(
            document.querySelectorAll(
                ".timeline-note[data-note-index]"
            )
        );

    if (!notes.length) {
        return null;
    }

    let nearestIndex = null;
    let nearestDistance = Infinity;

    notes.forEach(note => {

        const rect =
            note.getBoundingClientRect();

        const centreX =
            rect.left +
            (rect.width / 2);

        const distance =
            Math.abs(
                centreX - clientX
            );

        if (distance < nearestDistance) {

            const index =
                parseInt(
                    note.dataset.noteIndex ?? "",
                    10
                );

            if (Number.isFinite(index)) {
                nearestDistance = distance;
                nearestIndex = index;
            }
        }
    });

    return nearestIndex;
}


function updateLoopDrawSelectionAtPointer() {

    if (!loopDrawActive) {
        return;
    }

    let hitIndex =
        getSelectableNoteIndexFromPoint(
            loopDrawPointerX,
            loopDrawPointerY
        );

    /*
     * During edge auto-scroll the pointer may sit over empty
     * space between notes. In that case choose the note whose
     * label is horizontally closest to the pointer.
     */
    if (hitIndex === null) {
        hitIndex =
            getNearestTimelineNoteIndexByX(
                loopDrawPointerX
            );
    }

    if (hitIndex === null) {
        return;
    }

    const playableIndex =
        nearestPlayableIndex(
            hitIndex
        );

    if (playableIndex === null) {
        return;
    }

    if (
        playableIndex !==
        loopDrawCurrentIndex
    ) {

        loopDrawCurrentIndex =
            playableIndex;

        previewLoopRange(
            loopDrawStartIndex,
            loopDrawCurrentIndex
        );
    }
}


function stopLoopAutoScroll() {

    loopAutoScrollDirection = 0;

    if (loopAutoScrollFrame) {
        cancelAnimationFrame(
            loopAutoScrollFrame
        );
        loopAutoScrollFrame = null;
    }

    loopAutoScrollLastTime = 0;
}


function runLoopAutoScroll(now) {

    if (
        !loopDrawActive ||
        loopAutoScrollDirection === 0
    ) {
        stopLoopAutoScroll();
        return;
    }

    if (!loopAutoScrollLastTime) {
        loopAutoScrollLastTime = now;
    }

    const deltaSeconds =
        Math.min(
            0.05,
            (now - loopAutoScrollLastTime) /
            1000
        );

    loopAutoScrollLastTime = now;

    pausedMusicalBeats =
        clampBeat(
            pausedMusicalBeats +
            (
                loopAutoScrollDirection *
                LOOP_AUTO_SCROLL_BEATS_PER_SECOND *
                deltaSeconds
            )
        );

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(
            pausedMusicalBeats
        );
    }

    /*
     * As the timeline moves under the stationary pointer,
     * extend the loop selection to the newly revealed notes.
     */
    updateLoopDrawSelectionAtPointer();

    const atStart =
        pausedMusicalBeats <= 0;

    const atEnd =
        pausedMusicalBeats >=
        getTotalBeats();

    if (
        (atStart &&
         loopAutoScrollDirection < 0) ||
        (atEnd &&
         loopAutoScrollDirection > 0)
    ) {
        stopLoopAutoScroll();
        return;
    }

    loopAutoScrollFrame =
        requestAnimationFrame(
            runLoopAutoScroll
        );
}


function updateLoopAutoScrollDirection() {

    if (!loopDrawActive) {
        stopLoopAutoScroll();
        return;
    }

    const timeline =
        document.querySelector(
            ".tutorial-timeline"
        );

    if (!timeline) {
        stopLoopAutoScroll();
        return;
    }

    const rect =
        timeline.getBoundingClientRect();

    let direction = 0;

    if (
        loopDrawPointerX <=
        rect.left +
        LOOP_EDGE_SCROLL_ZONE
    ) {
        direction = -1;

    } else if (
        loopDrawPointerX >=
        rect.right -
        LOOP_EDGE_SCROLL_ZONE
    ) {
        direction = 1;
    }

    if (
        direction ===
        loopAutoScrollDirection
    ) {
        return;
    }

    stopLoopAutoScroll();

    loopAutoScrollDirection =
        direction;

    if (direction !== 0) {
        loopAutoScrollFrame =
            requestAnimationFrame(
                runLoopAutoScroll
            );
    }
}


function beginLoopDraw(
    event,
    noteIndex
) {

    if (!isLoopEnabled()) {
        return false;
    }

    const playableIndex =
        nearestPlayableIndex(
            noteIndex
        );

    if (playableIndex === null) {
        return false;
    }

    if (isPlaying) {
        pausePlayback();
    }

    loopDrawActive = true;

    loopDrawStartIndex =
        playableIndex;

    loopDrawCurrentIndex =
        playableIndex;

    loopDrawPointerId =
        event.pointerId;

    loopDrawPointerX =
        event.clientX;

    loopDrawPointerY =
        event.clientY;

    timelineDragActive = false;
    timelineDragMoved = false;

    const timeline =
        document.querySelector(
            ".tutorial-timeline"
        );

    timeline?.classList.add(
        "loop-drawing"
    );

    try {
        timeline?.setPointerCapture?.(
            event.pointerId
        );
    } catch (error) {
        // Pointer capture is optional.
    }

    previewLoopRange(
        loopDrawStartIndex,
        loopDrawCurrentIndex
    );

    event.preventDefault();

    return true;
}


function moveLoopDraw(event) {

    if (!loopDrawActive) {
        return;
    }

    loopDrawPointerX =
        event.clientX;

    loopDrawPointerY =
        event.clientY;

    updateLoopDrawSelectionAtPointer();

    updateLoopAutoScrollDirection();

    event.preventDefault();
}

function endLoopDraw(event) {

    if (!loopDrawActive) {
        return;
    }

    const timeline =
        document.querySelector(
            ".tutorial-timeline"
        );

    timeline?.classList.remove(
        "loop-drawing"
    );

    try {
        timeline?.releasePointerCapture?.(
            loopDrawPointerId
        );
    } catch (error) {
        // Ignore.
    }

    if (
        loopDrawStartIndex !== null &&
        loopDrawCurrentIndex !== null
    ) {
        setLoopRange(
            loopDrawStartIndex,
            loopDrawCurrentIndex
        );
    }

    clearLoopPreview();

    stopLoopAutoScroll();

    loopDrawActive = false;
    loopDrawStartIndex = null;
    loopDrawCurrentIndex = null;
    loopDrawPointerId = null;
    loopDrawPointerX = 0;
    loopDrawPointerY = 0;

    /*
     * Prevent the click generated after pointerup from
     * starting another loop selection.
     */
    timelineDragMoved = true;

    setTimeout(
        () => {
            timelineDragMoved = false;
        },
        100
    );

    event.preventDefault();
}


/* =========================================================
   Timeline drag / browse
   ========================================================= */

function pixelsPerBeat() {

    /*
     * Must match TIMELINE_PIXELS_PER_BEAT in index.html.
     */
    return 150;
}


function clampBeat(beat) {

    return Math.max(
        0,
        Math.min(
            getTotalBeats(),
            beat
        )
    );
}


function beginTimelineDrag(event) {

    const timeline =
        event.target.closest(
            ".tutorial-timeline"
        );

    if (!timeline) {
        return;
    }

    /*
     * Do not begin dragging from form controls.
     */
    if (
        event.target.closest(
            "button, select, input, label"
        )
    ) {
        return;
    }

    /*
     * Starting on a note/bar while Loop mode is enabled
     * means "draw a loop range", not pan the timeline.
     */
    const selectable =
        event.target.closest(
            ".loop-selectable[data-note-index]"
        );

    if (
        selectable &&
        isLoopEnabled()
    ) {
        const noteIndex =
            parseInt(
                selectable.dataset.noteIndex,
                10
            );

        if (
            Number.isFinite(noteIndex) &&
            beginLoopDraw(
                event,
                noteIndex
            )
        ) {
            return;
        }
    }

    /*
     * Otherwise the gesture is a normal timeline pan.
     */
    if (isPlaying) {
        pausePlayback();
    }

    timelineDragActive = true;
    timelineDragMoved = false;

    timelineDragStartX =
        event.clientX;

    timelineDragStartBeat =
        pausedMusicalBeats;
}


function moveTimelineDrag(event) {

    if (loopDrawActive) {
        moveLoopDraw(event);
        return;
    }

    if (!timelineDragActive) {
        return;
    }

    const deltaX =
        event.clientX -
        timelineDragStartX;

    if (
        !timelineDragMoved &&
        Math.abs(deltaX) >=
        TIMELINE_DRAG_THRESHOLD
    ) {
        timelineDragMoved = true;

        const timeline =
            document.querySelector(
                ".tutorial-timeline"
            );

        timeline?.classList.add(
            "dragging"
        );

        try {
            timeline?.setPointerCapture?.(
                event.pointerId
            );
        } catch (error) {
            // Pointer capture is optional.
        }
    }

    if (!timelineDragMoved) {
        return;
    }

    event.preventDefault();

    /*
     * Dragging the content right means browsing earlier.
     * Dragging left means browsing later.
     */
    const beatDelta =
        -deltaX /
        pixelsPerBeat();

    pausedMusicalBeats =
        clampBeat(
            timelineDragStartBeat +
            beatDelta
        );

    if (window.setTimelineBeatPosition) {
        window.setTimelineBeatPosition(
            pausedMusicalBeats
        );
    }

    /*
     * Keep note highlight roughly aligned with the
     * current browse position.
     */
    let closestIndex = 0;
    let closestDistance = Infinity;

    tutorialNotes.forEach(
        (note, index) => {

            const distance =
                Math.abs(
                    note.offset -
                    pausedMusicalBeats
                );

            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
            }
        }
    );

    highlightEvent(
        closestIndex
    );
}


function endTimelineDrag(event) {

    if (loopDrawActive) {
        endLoopDraw(event);
        return;
    }

    if (!timelineDragActive) {
        return;
    }

    const timeline =
        event.target.closest(
            ".tutorial-timeline"
        ) ||
        document.querySelector(
            ".tutorial-timeline"
        );

    timelineDragActive = false;

    timeline?.classList.remove(
        "dragging"
    );

    try {
        timeline?.releasePointerCapture?.(
            event.pointerId
        );
    } catch (error) {
        // Capture may already be released.
    }

    /*
     * If the pointer actually moved, suppress the click
     * that browsers normally fire after a drag.
     */
    if (timelineDragMoved) {

        event.preventDefault();

        /*
         * Keep the suppression flag alive long enough for
         * the synthetic click event that follows pointerup.
         */
        setTimeout(
            () => {
                timelineDragMoved = false;
            },
            80
        );

    } else {

        timelineDragMoved = false;
    }
}


function shouldSuppressTimelineClick() {

    return timelineDragMoved;
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

        const timeline =
            document.querySelector(
                ".tutorial-timeline"
            );

        timeline?.addEventListener(
            "pointerdown",
            beginTimelineDrag
        );

        timeline?.addEventListener(
            "pointermove",
            moveTimelineDrag
        );

        timeline?.addEventListener(
            "pointerup",
            endTimelineDrag
        );

        timeline?.addEventListener(
            "pointercancel",
            endTimelineDrag
        );

        wireAudioControls();

        const loopEnabled =
            document.getElementById(
                "loop-enabled"
            );

        const loopStart =
            document.getElementById(
                "loop-start"
            );

        const loopEnd =
            document.getElementById(
                "loop-end"
            );

        loopEnabled?.addEventListener(
            "change",
            () => {

                const enabled =
                    loopEnabled.checked;

                if (loopStart) {
                    loopStart.disabled =
                        !enabled;
                }

                if (loopEnd) {
                    loopEnd.disabled =
                        !enabled;
                }

                loopHasCountedIn = false;
                timelineLoopClickStage =
                    "start";

                stopLoopAutoScroll();

                loopDrawActive = false;
                loopDrawStartIndex = null;
                loopDrawCurrentIndex = null;
                loopDrawPointerId = null;
                loopDrawPointerX = 0;
                loopDrawPointerY = 0;

                clearLoopPreview();

                if (isPlaying) {
                    pausePlayback();
                }

                refreshTimelineLoopHighlight();

                if (enabled) {

                    const bounds =
                        getLoopBounds();

                    pausedMusicalBeats =
                        bounds.startBeat;

                    highlightEvent(
                        bounds.startIndex
                    );

                    if (
                        window
                            .setTimelineBeatPosition
                    ) {
                        window.setTimelineBeatPosition(
                            bounds.startBeat
                        );
                    }

                    refreshTimelineLoopHighlight();
                }
            }
        );

        [loopStart, loopEnd]
            .forEach(select => {

                select?.addEventListener(
                    "change",
                    () => {

                        loopHasCountedIn =
                            false;

                        timelineLoopClickStage =
                            "start";

                        if (isPlaying) {
                            pausePlayback();
                        }

                        if (isLoopEnabled()) {

                            const bounds =
                                getLoopBounds();

                            pausedMusicalBeats =
                                bounds.startBeat;

                            highlightEvent(
                                bounds.startIndex
                            );

                            if (
                                window
                                    .setTimelineBeatPosition
                            ) {
                                window.setTimelineBeatPosition(
                                    bounds.startBeat
                                );
                            }

                            refreshTimelineLoopHighlight();
                        }
                    }
                );
            });

    }
);


window.loadTutorialPlayer =
    loadTutorialPlayer;

window.handleTimelineLoopClick =
    handleTimelineLoopClick;


/*
 * Public coaching-state helpers.
 * No selected loop => coaching scores the whole song.
 * Selected loop    => coaching scores only the active range.
 */
window.getTutorialCoachingState = function () {

    const enabled =
        isLoopEnabled();

    const bounds =
        getLoopBounds();

    return {
        loopActive:
            enabled,
        startBeat:
            enabled
                ? bounds.startBeat
                : 0,
        endBeat:
            enabled
                ? bounds.endBeat
                : getTotalBeats()
    };
};
