/*
 * YourMusicTutorial - Score MusicXML v1
 *
 * Loads a real MusicXML file in the browser, extracts:
 *   pitch
 *   start offset
 *   duration
 *   rests
 *
 * Then scores a simulated performance using:
 *   real Iowa WAV pitch detection
 *   timing offsets
 *   duration/hold controls
 *
 * Tempo:
 * MusicXML files without an explicit tempo are scored at 120 BPM,
 * matching the current tutorial player's BASE_BPM.
 */

const SAMPLE_BASE =
    "/static/audio/saxophone/alto/samples/mf/";

const SAMPLE_NOTES = [
    "Db3", "D3", "Eb3", "E3", "F3", "Gb3",
    "G3", "Ab3", "A3", "Bb3", "B3",
    "C4", "Db4", "D4", "Eb4", "E4", "F4",
    "Gb4", "G4", "Ab4", "A4", "Bb4", "B4",
    "C5", "Db5", "D5", "Eb5", "E5", "F5",
    "Gb5", "G5", "Ab5"
];

const DEFAULT_BPM = 120;

let audioContext = null;
let loadedPhrase = [];

let currentResults = [];
let recommendedLoop = null;

const PRACTICE_PIXELS_PER_SECOND = 160;

let practiceTimelineDragging = false;
let practiceTimelineDragStartX = 0;
let practiceTimelineScrollStart = 0;


function ensureAudioContext() {
    if (!audioContext) {
        const AudioContextClass =
            window.AudioContext ||
            window.webkitAudioContext;

        audioContext =
            new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
        audioContext.resume();
    }
}


function alterToAccidental(alter) {
    if (alter === 1) return "#";
    if (alter === -1) return "b";
    return "";
}


function parseMusicXML(text) {

    const parser =
        new DOMParser();

    const xml =
        parser.parseFromString(
            text,
            "application/xml"
        );

    const parserError =
        xml.querySelector(
            "parsererror"
        );

    if (parserError) {
        throw new Error(
            "The MusicXML file could not be parsed."
        );
    }

    const part =
        xml.querySelector("part");

    if (!part) {
        throw new Error(
            "No musical part was found in the MusicXML file."
        );
    }

    let divisions = 1;
    let offsetBeats = 0;
    let bpm = DEFAULT_BPM;

    /*
     * Read first explicit tempo if present.
     */
    const soundTempo =
        xml.querySelector(
            "sound[tempo]"
        );

    if (soundTempo) {
        const value =
            parseFloat(
                soundTempo.getAttribute(
                    "tempo"
                )
            );

        if (
            Number.isFinite(value) &&
            value > 0
        ) {
            bpm = value;
        }
    }

    const metronomePerMinute =
        xml.querySelector(
            "metronome per-minute"
        );

    if (
        metronomePerMinute &&
        !soundTempo
    ) {
        const value =
            parseFloat(
                metronomePerMinute.textContent
            );

        if (
            Number.isFinite(value) &&
            value > 0
        ) {
            bpm = value;
        }
    }

    const events = [];

    const measures =
        Array.from(
            part.querySelectorAll(
                ":scope > measure"
            )
        );

    measures.forEach(measure => {

        const divisionsNode =
            measure.querySelector(
                "attributes > divisions"
            );

        if (divisionsNode) {
            const parsed =
                parseFloat(
                    divisionsNode.textContent
                );

            if (
                Number.isFinite(parsed) &&
                parsed > 0
            ) {
                divisions =
                    parsed;
            }
        }

        const notes =
            Array.from(
                measure.children
            ).filter(
                node =>
                    node.tagName ===
                    "note"
            );

        notes.forEach(noteNode => {

            /*
             * Chords reuse the previous note start.
             * This v1 scoring lab is monophonic, so skip extra chord tones.
             */
            if (
                noteNode.querySelector(
                    ":scope > chord"
                )
            ) {
                return;
            }

            const durationNode =
                noteNode.querySelector(
                    ":scope > duration"
                );

            if (!durationNode) {
                return;
            }

            const durationDivisions =
                parseFloat(
                    durationNode.textContent
                );

            if (
                !Number.isFinite(
                    durationDivisions
                )
            ) {
                return;
            }

            const durationBeats =
                durationDivisions /
                divisions;

            const rest =
                Boolean(
                    noteNode.querySelector(
                        ":scope > rest"
                    )
                );

            if (rest) {

                events.push({
                    type: "rest",
                    pitch: "REST",
                    offsetBeats,
                    durationBeats
                });

                offsetBeats +=
                    durationBeats;

                return;
            }

            const step =
                noteNode.querySelector(
                    "pitch > step"
                )?.textContent;

            const octave =
                noteNode.querySelector(
                    "pitch > octave"
                )?.textContent;

            const alter =
                parseInt(
                    noteNode.querySelector(
                        "pitch > alter"
                    )?.textContent ??
                    "0",
                    10
                );

            if (
                !step ||
                octave === undefined
            ) {
                return;
            }

            const pitch =
                `${step}${alterToAccidental(
                    alter
                )}${octave}`;

            events.push({
                type: "note",
                pitch,
                offsetBeats,
                durationBeats
            });

            offsetBeats +=
                durationBeats;
        });
    });

    const secondsPerBeat =
        60 / bpm;

    const playable =
        events
            .filter(
                event =>
                    event.type ===
                    "note"
            )
            .map(
                event => ({
                    pitch:
                        normaliseToSampleName(
                            event.pitch
                        ),
                    originalPitch:
                        event.pitch,
                    start:
                        event.offsetBeats *
                        secondsPerBeat,
                    duration:
                        event.durationBeats *
                        secondsPerBeat,
                    startBeats:
                        event.offsetBeats,
                    durationBeats:
                        event.durationBeats
                })
            );

    if (!playable.length) {
        throw new Error(
            "No playable notes were found."
        );
    }

    return {
        bpm,
        playable,
        eventCount:
            events.length
    };
}


function normaliseToSampleName(
    noteName
) {

    const match =
        String(noteName).match(
            /^([A-G])([#b]?)(-?\d+)$/
        );

    if (!match) {
        return noteName;
    }

    const [
        ,
        letter,
        accidental,
        octave
    ] = match;

    const sharpToFlat = {
        "C#": "Db",
        "D#": "Eb",
        "F#": "Gb",
        "G#": "Ab",
        "A#": "Bb"
    };

    let pitchClass =
        `${letter}${accidental}`;

    if (
        sharpToFlat[
            pitchClass
        ]
    ) {
        pitchClass =
            sharpToFlat[
                pitchClass
            ];
    }

    return (
        pitchClass +
        octave
    );
}


async function loadChosenFile() {

    const input =
        document.getElementById(
            "musicxml-file"
        );

    const status =
        document.getElementById(
            "load-status"
        );

    const file =
        input.files?.[0];

    if (!file) {
        status.textContent =
            "Choose a MusicXML file first.";
        return;
    }

    try {

        status.textContent =
            `Loading ${file.name}...`;

        const text =
            await file.text();

        const parsed =
            parseMusicXML(
                text
            );

        loadedPhrase =
            parsed.playable;

        buildPerformanceUI();

        renderPracticeTimeline();

        document.getElementById(
            "performance-card"
        ).style.display =
            "block";

        document.getElementById(
            "summary"
        ).style.display =
            "none";

        status.textContent =
            `Loaded ${file.name}: ${parsed.playable.length} playable notes at ${parsed.bpm} BPM. Rests are preserved in the timing.`;

    } catch (error) {

        console.error(error);

        status.textContent =
            `Error: ${error.message}`;
    }
}


function buildPerformanceUI() {

    const grid =
        document.getElementById(
            "phrase-grid"
        );

    grid.innerHTML = "";

    loadedPhrase.forEach(
        (item, index) => {

            const maxDuration =
                Math.max(
                    0.5,
                    item.duration *
                    1.75
                );

            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "phrase-row";

            row.innerHTML = `
                <div class="num">
                    ${index + 1}
                </div>

                <div class="expected-note">
                    ${item.pitch}
                </div>

                <div class="meta-cell meta">
                    start ${item.start.toFixed(2)}s
                    <br>
                    hold ${item.duration.toFixed(2)}s
                </div>

                <div>
                    <span class="control-label">
                        Played sample
                    </span>

                    <select
                        class="played-select"
                        data-index="${index}"
                    ></select>
                </div>

                <div class="timing-cell">
                    <span class="control-label">
                        Timing offset (s)
                    </span>

                    <div class="slider-control">
                        <input
                            type="range"
                            class="timing-slider"
                            data-index="${index}"
                            min="-0.60"
                            max="0.60"
                            step="0.01"
                            value="0"
                        >

                        <input
                            type="number"
                            class="timing-number"
                            data-index="${index}"
                            min="-0.60"
                            max="0.60"
                            step="0.01"
                            value="0"
                        >
                    </div>
                </div>

                <div class="duration-cell">
                    <span class="control-label">
                        Held duration (s)
                    </span>

                    <div class="slider-control">
                        <input
                            type="range"
                            class="duration-slider"
                            data-index="${index}"
                            min="0.05"
                            max="${maxDuration.toFixed(2)}"
                            step="0.01"
                            value="${item.duration.toFixed(2)}"
                        >

                        <input
                            type="number"
                            class="duration-number"
                            data-index="${index}"
                            min="0.05"
                            max="${maxDuration.toFixed(2)}"
                            step="0.01"
                            value="${item.duration.toFixed(2)}"
                        >
                    </div>
                </div>
            `;

            const select =
                row.querySelector(
                    ".played-select"
                );

            SAMPLE_NOTES.forEach(note => {

                const option =
                    document.createElement(
                        "option"
                    );

                option.value = note;
                option.textContent =
                    `${note}.wav`;

                select.appendChild(
                    option
                );
            });

            if (
                SAMPLE_NOTES.includes(
                    item.pitch
                )
            ) {
                select.value =
                    item.pitch;
            }

            grid.appendChild(
                row
            );
        }
    );

    wirePairs(
        ".timing-slider",
        ".timing-number"
    );

    wirePairs(
        ".duration-slider",
        ".duration-number"
    );
}


function wirePairs(
    sliderSelector,
    numberSelector
) {

    document
        .querySelectorAll(
            sliderSelector
        )
        .forEach(slider => {

            slider.addEventListener(
                "input",
                () => {

                    const number =
                        document.querySelector(
                            `${numberSelector}[data-index="${slider.dataset.index}"]`
                        );

                    if (number) {
                        number.value =
                            slider.value;
                    }
                }
            );
        });

    document
        .querySelectorAll(
            numberSelector
        )
        .forEach(number => {

            number.addEventListener(
                "input",
                () => {

                    const slider =
                        document.querySelector(
                            `${sliderSelector}[data-index="${number.dataset.index}"]`
                        );

                    if (slider) {
                        slider.value =
                            number.value;
                    }
                }
            );
        });
}


async function loadSample(
    noteName
) {

    ensureAudioContext();

    const response =
        await fetch(
            `${SAMPLE_BASE}${noteName}.wav`
        );

    if (!response.ok) {
        throw new Error(
            `Could not load ${noteName}.wav`
        );
    }

    const bytes =
        await response.arrayBuffer();

    return await audioContext.decodeAudioData(
        bytes
    );
}


function toMono(buffer) {

    if (
        buffer.numberOfChannels ===
        1
    ) {
        return buffer.getChannelData(
            0
        );
    }

    const mono =
        new Float32Array(
            buffer.length
        );

    for (
        let channel = 0;
        channel <
        buffer.numberOfChannels;
        channel++
    ) {

        const data =
            buffer.getChannelData(
                channel
            );

        for (
            let i = 0;
            i < buffer.length;
            i++
        ) {

            mono[i] +=
                data[i] /
                buffer.numberOfChannels;
        }
    }

    return mono;
}


function rms(frame) {
    let sum = 0;

    for (
        let i = 0;
        i < frame.length;
        i++
    ) {
        sum +=
            frame[i] *
            frame[i];
    }

    return Math.sqrt(
        sum /
        frame.length
    );
}


function yinPitch(
    frame,
    sampleRate
) {

    const minFrequency = 90;
    const maxFrequency = 1000;

    const minTau =
        Math.max(
            2,
            Math.floor(
                sampleRate /
                maxFrequency
            )
        );

    const maxTau =
        Math.min(
            Math.floor(
                sampleRate /
                minFrequency
            ),
            Math.floor(
                frame.length /
                2
            )
        );

    const difference =
        new Float64Array(
            maxTau + 1
        );

    for (
        let tau = 1;
        tau <= maxTau;
        tau++
    ) {

        let sum = 0;

        const limit =
            frame.length -
            tau;

        for (
            let i = 0;
            i < limit;
            i++
        ) {

            const delta =
                frame[i] -
                frame[
                    i + tau
                ];

            sum +=
                delta *
                delta;
        }

        difference[tau] =
            sum;
    }

    const cmnd =
        new Float64Array(
            maxTau + 1
        );

    cmnd[0] = 1;

    let runningSum = 0;

    for (
        let tau = 1;
        tau <= maxTau;
        tau++
    ) {

        runningSum +=
            difference[tau];

        cmnd[tau] =
            runningSum === 0
                ? 1
                : (
                    difference[tau] *
                    tau /
                    runningSum
                );
    }

    let tauEstimate = -1;
    const threshold = 0.15;

    for (
        let tau = minTau;
        tau < maxTau;
        tau++
    ) {

        if (
            cmnd[tau] <
            threshold
        ) {

            while (
                tau + 1 <=
                maxTau &&
                cmnd[tau + 1] <
                cmnd[tau]
            ) {
                tau++;
            }

            tauEstimate = tau;
            break;
        }
    }

    if (tauEstimate < 0) {

        let bestValue =
            Infinity;

        for (
            let tau = minTau;
            tau <= maxTau;
            tau++
        ) {

            if (
                cmnd[tau] <
                bestValue
            ) {
                bestValue =
                    cmnd[tau];

                tauEstimate =
                    tau;
            }
        }
    }

    if (
        tauEstimate <= 0
    ) {
        return null;
    }

    let betterTau =
        tauEstimate;

    if (
        tauEstimate >
        minTau &&
        tauEstimate <
        maxTau
    ) {

        const left =
            cmnd[
                tauEstimate - 1
            ];

        const centre =
            cmnd[
                tauEstimate
            ];

        const right =
            cmnd[
                tauEstimate + 1
            ];

        const denominator =
            (
                2 * centre
            ) -
            left -
            right;

        if (
            Math.abs(
                denominator
            ) >
            1e-12
        ) {

            betterTau =
                tauEstimate +
                0.5 *
                (
                    right -
                    left
                ) /
                denominator;
        }
    }

    return {
        frequency:
            sampleRate /
            betterTau,

        confidence:
            Math.max(
                0,
                Math.min(
                    1,
                    1 -
                    cmnd[
                        tauEstimate
                    ]
                )
            )
    };
}


function median(values) {

    const sorted =
        [...values].sort(
            (a, b) =>
                a - b
        );

    const middle =
        Math.floor(
            sorted.length /
            2
        );

    if (
        sorted.length %
        2 === 0
    ) {
        return (
            sorted[
                middle - 1
            ] +
            sorted[
                middle
            ]
        ) / 2;
    }

    return sorted[
        middle
    ];
}


function analyseBuffer(buffer) {

    const mono =
        toMono(buffer);

    const sampleRate =
        buffer.sampleRate;

    const frameSize =
        4096;

    const fractions = [
        0.18,
        0.28,
        0.38,
        0.48,
        0.58,
        0.68
    ];

    const results = [];

    fractions.forEach(
        fraction => {

            const centre =
                Math.floor(
                    mono.length *
                    fraction
                );

            const start =
                Math.max(
                    0,
                    Math.min(
                        mono.length -
                        frameSize,
                        centre -
                        Math.floor(
                            frameSize /
                            2
                        )
                    )
                );

            const frame =
                mono.subarray(
                    start,
                    start +
                    frameSize
                );

            if (
                rms(frame) <
                0.003
            ) {
                return;
            }

            const result =
                yinPitch(
                    frame,
                    sampleRate
                );

            if (result) {
                results.push(
                    result
                );
            }
        }
    );

    if (!results.length) {
        throw new Error(
            "No stable pitch detected."
        );
    }

    const roughMedian =
        median(
            results.map(
                result =>
                    result.frequency
            )
        );

    const filtered =
        results.filter(
            result => {

                const ratio =
                    result.frequency /
                    roughMedian;

                return (
                    ratio > 0.80 &&
                    ratio < 1.20
                );
            }
        );

    const usable =
        filtered.length
            ? filtered
            : results;

    return {
        frequency:
            median(
                usable.map(
                    result =>
                        result.frequency
                )
            ),

        confidence:
            median(
                usable.map(
                    result =>
                        result.confidence
                )
            )
    };
}


function frequencyToMidi(
    frequency
) {
    return (
        69 +
        12 *
        Math.log2(
            frequency /
            440
        )
    );
}


function midiToNoteName(
    midi
) {

    const names = [
        "C", "Db", "D", "Eb",
        "E", "F", "Gb", "G",
        "Ab", "A", "Bb", "B"
    ];

    const rounded =
        Math.round(
            midi
        );

    const pitchClass =
        (
            (
                rounded %
                12
            ) +
            12
        ) % 12;

    const octave =
        Math.floor(
            rounded /
            12
        ) - 1;

    return (
        names[
            pitchClass
        ] +
        octave
    );
}


function noteNameToMidi(
    noteName
) {

    const match =
        String(noteName).match(
            /^([A-G])([b#]?)(-?\d+)$/
        );

    if (!match) {
        return null;
    }

    const [
        ,
        letter,
        accidental,
        octaveText
    ] = match;

    const base = {
        C: 0,
        D: 2,
        E: 4,
        F: 5,
        G: 7,
        A: 9,
        B: 11
    }[letter];

    let semitone =
        base;

    if (
        accidental === "#"
    ) {
        semitone++;
    }

    if (
        accidental === "b"
    ) {
        semitone--;
    }

    return (
        (
            parseInt(
                octaveText,
                10
            ) + 1
        ) *
        12 +
        semitone
    );
}


function midiToFrequency(
    midi
) {
    return (
        440 *
        Math.pow(
            2,
            (
                midi -
                69
            ) /
            12
        )
    );
}


function scorePitch(
    expectedNote,
    analysis
) {

    const expectedMidi =
        noteNameToMidi(
            expectedNote
        );

    const detectedMidi =
        Math.round(
            frequencyToMidi(
                analysis.frequency
            )
        );

    const detectedNote =
        midiToNoteName(
            detectedMidi
        );

    const correct =
        detectedMidi ===
        expectedMidi;

    const expectedFrequency =
        midiToFrequency(
            expectedMidi
        );

    const cents =
        1200 *
        Math.log2(
            analysis.frequency /
            expectedFrequency
        );

    let tuningScore =
        null;

    if (correct) {

        const abs =
            Math.abs(
                cents
            );

        tuningScore =
            abs <= 5
                ? 100
                : Math.max(
                    0,
                    Math.round(
                        100 -
                        (
                            abs -
                            5
                        ) *
                        1.6
                    )
                );
    }

    return {
        detectedNote,
        correct,
        cents,
        tuningScore,
        confidence:
            analysis.confidence
    };
}


function scoreTiming(error) {

    const abs =
        Math.abs(
            error
        );

    if (abs <= 0.05) {
        return {
            score: 100,
            label: "Excellent"
        };
    }

    if (abs <= 0.12) {
        return {
            score:
                Math.round(
                    100 -
                    (
                        (
                            abs -
                            0.05
                        ) /
                        0.07
                    ) *
                    12
                ),
            label: "Good"
        };
    }

    if (abs <= 0.22) {
        return {
            score:
                Math.round(
                    88 -
                    (
                        (
                            abs -
                            0.12
                        ) /
                        0.10
                    ) *
                    23
                ),
            label: "Fair"
        };
    }

    if (abs <= 0.35) {
        return {
            score:
                Math.round(
                    65 -
                    (
                        (
                            abs -
                            0.22
                        ) /
                        0.13
                    ) *
                    35
                ),
            label:
                error < 0
                    ? "Early"
                    : "Late"
        };
    }

    return {
        score:
            Math.max(
                0,
                Math.round(
                    30 -
                    (
                        abs -
                        0.35
                    ) *
                    60
                )
            ),
        label:
            error < 0
                ? "Very early"
                : "Very late"
    };
}


function scoreDuration(
    expected,
    actual
) {

    const difference =
        actual -
        expected;

    const relativeError =
        Math.abs(
            difference
        ) /
        expected;

    if (
        relativeError <=
        0.05
    ) {
        return {
            score: 100,
            label: "Excellent"
        };
    }

    if (
        relativeError <=
        0.12
    ) {
        return {
            score:
                Math.round(
                    100 -
                    (
                        (
                            relativeError -
                            0.05
                        ) /
                        0.07
                    ) *
                    12
                ),
            label: "Good"
        };
    }

    if (
        relativeError <=
        0.22
    ) {
        return {
            score:
                Math.round(
                    88 -
                    (
                        (
                            relativeError -
                            0.12
                        ) /
                        0.10
                    ) *
                    23
                ),
            label: "Fair"
        };
    }

    if (
        relativeError <=
        0.35
    ) {
        return {
            score:
                Math.round(
                    65 -
                    (
                        (
                            relativeError -
                            0.22
                        ) /
                        0.13
                    ) *
                    35
                ),
            label:
                difference < 0
                    ? "Short"
                    : "Long"
        };
    }

    return {
        score:
            Math.max(
                0,
                Math.round(
                    30 -
                    (
                        relativeError -
                        0.35
                    ) *
                    55
                )
            ),
        label:
            difference < 0
                ? "Much too short"
                : "Much too long"
    };
}


function scoreClass(
    value
) {
    if (value >= 85) {
        return "good";
    }

    if (value >= 60) {
        return "warn";
    }

    return "bad";
}


async function analysePerformance() {

    const status =
        document.getElementById(
            "analysis-status"
        );

    const button =
        document.getElementById(
            "analyse-performance"
        );

    const played =
        Array.from(
            document.querySelectorAll(
                ".played-select"
            )
        );

    const timingInputs =
        Array.from(
            document.querySelectorAll(
                ".timing-number"
            )
        );

    const durationInputs =
        Array.from(
            document.querySelectorAll(
                ".duration-number"
            )
        );

    button.disabled =
        true;

    button.textContent =
        "Analysing...";

    const results = [];

    try {

        for (
            let index = 0;
            index < loadedPhrase.length;
            index++
        ) {

            const expected =
                loadedPhrase[
                    index
                ];

            const playedNote =
                played[
                    index
                ].value;

            const timingError =
                parseFloat(
                    timingInputs[
                        index
                    ].value
                ) || 0;

            const heldDuration =
                Math.max(
                    0.05,
                    parseFloat(
                        durationInputs[
                            index
                        ].value
                    ) ||
                    expected.duration
                );

            status.textContent =
                `Analysing ${index + 1}/${loadedPhrase.length}: ${playedNote}.wav`;

            const buffer =
                await loadSample(
                    playedNote
                );

            await new Promise(
                resolve =>
                    requestAnimationFrame(
                        resolve
                    )
            );

            const pitchAnalysis =
                analyseBuffer(
                    buffer
                );

            results.push({
                index,
                expected,
                timingError,
                heldDuration,
                ...scorePitch(
                    expected.pitch,
                    pitchAnalysis
                ),
                timing:
                    scoreTiming(
                        timingError
                    ),
                duration:
                    scoreDuration(
                        expected.duration,
                        heldDuration
                    )
            });
        }

        renderResults(
            results
        );

        status.textContent =
            "Performance analysis complete.";

    } catch (error) {

        console.error(
            error
        );

        status.textContent =
            `Error: ${error.message}`;

    } finally {

        button.disabled =
            false;

        button.textContent =
            "Analyse Full Performance";
    }
}


function calculateSummary(
    results
) {

    const correct =
        results.filter(
            result =>
                result.correct
        );

    const noteAccuracy =
        Math.round(
            correct.length /
            results.length *
            100
        );

    const tuning =
        correct.length
            ? Math.round(
                correct.reduce(
                    (
                        sum,
                        result
                    ) =>
                        sum +
                        (
                            result.tuningScore ??
                            0
                        ),
                    0
                ) /
                correct.length
            )
            : 0;

    const timing =
        Math.round(
            results.reduce(
                (
                    sum,
                    result
                ) =>
                    sum +
                    result.timing.score,
                0
            ) /
                results.length
        );

    const duration =
        Math.round(
            results.reduce(
                (
                    sum,
                    result
                ) =>
                    sum +
                    result.duration.score,
                0
            ) /
                results.length
        );

    const overall =
        Math.round(
            noteAccuracy *
                0.50 +
            tuning *
                0.15 +
            timing *
                0.20 +
            duration *
                0.15
        );

    return {
        noteAccuracy,
        tuning,
        timing,
        duration,
        overall
    };
}


function weaknessFor(
    result
) {

    const issues = [];

    if (!result.correct) {
        issues.push(
            "Wrong note"
        );
    }

    if (
        result.correct &&
        (
            result.tuningScore ??
            100
        ) <
        70
    ) {
        issues.push(
            result.cents < 0
                ? "Flat"
                : "Sharp"
        );
    }

    if (
        result.timing.score <
        70
    ) {
        issues.push(
            result.timing.label
        );
    }

    if (
        result.duration.score <
        70
    ) {
        issues.push(
            `Duration: ${result.duration.label}`
        );
    }

    return issues.length
        ? issues.join(", ")
        : "Good";
}




function renderPracticeTimeline() {

    const track =
        document.getElementById(
            "practice-timeline-track"
        );

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    if (
        !track ||
        !viewport ||
        !loadedPhrase.length
    ) {
        return;
    }

    track.innerHTML = "";

    const totalSeconds =
        Math.max(
            ...loadedPhrase.map(
                note =>
                    note.start +
                    note.duration
            )
        );

    /*
     * Add padding so the first/last notes can reach the fixed playhead.
     */
    const sidePadding =
        Math.max(
            260,
            viewport.clientWidth /
            2
        );

    const contentWidth =
        sidePadding * 2 +
        totalSeconds *
        PRACTICE_PIXELS_PER_SECOND;

    track.style.width =
        `${contentWidth}px`;

    loadedPhrase.forEach(
        (note, index) => {

            const left =
                sidePadding +
                note.start *
                PRACTICE_PIXELS_PER_SECOND;

            const width =
                Math.max(
                    8,
                    note.duration *
                    PRACTICE_PIXELS_PER_SECOND -
                    6
                );

            const label =
                document.createElement(
                    "div"
                );

            label.className =
                "practice-note";

            label.textContent =
                note.pitch;

            label.style.left =
                `${left}px`;

            track.appendChild(
                label
            );

            const bar =
                document.createElement(
                    "div"
                );

            bar.className =
                "practice-bar";

            bar.dataset.noteIndex =
                String(index);

            bar.style.left =
                `${left}px`;

            bar.style.width =
                `${width}px`;

            track.appendChild(
                bar
            );
        }
    );

    if (recommendedLoop) {
        highlightRecommendedLoopOnTimeline();
    }

    /*
     * Start at the beginning with note 1 near the playhead.
     */
    viewport.scrollLeft =
        Math.max(
            0,
            sidePadding -
            viewport.clientWidth /
            2
        );
}


function highlightRecommendedLoopOnTimeline() {

    const track =
        document.getElementById(
            "practice-timeline-track"
        );

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    if (
        !track ||
        !viewport ||
        !recommendedLoop ||
        !loadedPhrase.length
    ) {
        return;
    }

    track
        .querySelectorAll(
            ".practice-loop-shade"
        )
        .forEach(
            element =>
                element.remove()
        );

    track
        .querySelectorAll(
            ".practice-bar"
        )
        .forEach(bar =>
            bar.classList.remove(
                "loop-range"
            )
        );

    const startNote =
        loadedPhrase[
            recommendedLoop.startIndex
        ];

    const endNote =
        loadedPhrase[
            recommendedLoop.endIndex
        ];

    if (!startNote || !endNote) {
        return;
    }

    const sidePadding =
        Math.max(
            260,
            viewport.clientWidth /
            2
        );

    const startX =
        sidePadding +
        startNote.start *
        PRACTICE_PIXELS_PER_SECOND;

    const endX =
        sidePadding +
        (
            endNote.start +
            endNote.duration
        ) *
        PRACTICE_PIXELS_PER_SECOND;

    const shade =
        document.createElement(
            "div"
        );

    shade.className =
        "practice-loop-shade";

    shade.style.left =
        `${startX}px`;

    shade.style.width =
        `${Math.max(
            10,
            endX - startX
        )}px`;

    track.appendChild(
        shade
    );

    for (
        let index =
            recommendedLoop.startIndex;
        index <=
            recommendedLoop.endIndex;
        index++
    ) {

        track
            .querySelector(
                `.practice-bar[data-note-index="${index}"]`
            )
            ?.classList.add(
                "loop-range"
            );
    }

    /*
     * Centre the recommended loop under the fixed playhead.
     */
    const loopCentre =
        (
            startX +
            endX
        ) /
        2;

    viewport.scrollLeft =
        Math.max(
            0,
            loopCentre -
            viewport.clientWidth /
            2
        );
}


function beginPracticeTimelineDrag(
    event
) {

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    if (!viewport) {
        return;
    }

    practiceTimelineDragging =
        true;

    practiceTimelineDragStartX =
        event.clientX;

    practiceTimelineScrollStart =
        viewport.scrollLeft;

    viewport.classList.add(
        "dragging"
    );

    try {
        viewport.setPointerCapture(
            event.pointerId
        );
    } catch (error) {
        // Optional.
    }
}


function movePracticeTimelineDrag(
    event
) {

    if (!practiceTimelineDragging) {
        return;
    }

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    if (!viewport) {
        return;
    }

    const delta =
        event.clientX -
        practiceTimelineDragStartX;

    viewport.scrollLeft =
        practiceTimelineScrollStart -
        delta;

    event.preventDefault();
}


function endPracticeTimelineDrag(
    event
) {

    if (!practiceTimelineDragging) {
        return;
    }

    const viewport =
        document.getElementById(
            "practice-timeline-viewport"
        );

    practiceTimelineDragging =
        false;

    viewport?.classList.remove(
        "dragging"
    );

    try {
        viewport?.releasePointerCapture(
            event.pointerId
        );
    } catch (error) {
        // Ignore.
    }
}


function issueSeverity(result) {

    /*
     * Higher = more urgent.
     * Wrong notes matter most, then timing/duration.
     * Tuning only contributes when the note itself was correct.
     */
    let severity = 0;

    if (!result.correct) {
        severity += 100;
    }

    if (
        result.correct &&
        result.tuningScore !== null
    ) {
        severity +=
            Math.max(
                0,
                70 -
                result.tuningScore
            );
    }

    severity +=
        Math.max(
            0,
            75 -
            result.timing.score
        ) *
        0.8;

    severity +=
        Math.max(
            0,
            75 -
            result.duration.score
        ) *
        0.7;

    return severity;
}


function dominantIssue(results) {

    let wrong = 0;
    let timing = 0;
    let duration = 0;
    let tuning = 0;

    results.forEach(result => {

        if (!result.correct) {
            wrong++;
        }

        if (result.timing.score < 70) {
            timing++;
        }

        if (result.duration.score < 70) {
            duration++;
        }

        if (
            result.correct &&
            result.tuningScore !== null &&
            result.tuningScore < 70
        ) {
            tuning++;
        }
    });

    const ranked = [
        ["Wrong notes", wrong],
        ["Timing", timing],
        ["Duration", duration],
        ["Tuning", tuning]
    ].sort(
        (a, b) =>
            b[1] - a[1]
    );

    return ranked[0][1] > 0
        ? ranked[0][0]
        : "General polish";
}


function recommendedSpeedFor(segment) {

    const averageSeverity =
        segment.reduce(
            (sum, result) =>
                sum +
                issueSeverity(result),
            0
        ) /
        segment.length;

    if (averageSeverity >= 75) {
        return "50%";
    }

    if (averageSeverity >= 35) {
        return "75%";
    }

    return "100%";
}


function findRecommendedLoop(results) {

    if (!results.length) {
        return null;
    }

    /*
     * Look for a useful contiguous window rather than a list
     * of every imperfect note. Try 3–6 note windows and choose
     * the highest average severity with a small bonus for compactness.
     */
    const minWindow =
        Math.min(
            3,
            results.length
        );

    const maxWindow =
        Math.min(
            6,
            results.length
        );

    let best = null;

    for (
        let size = minWindow;
        size <= maxWindow;
        size++
    ) {

        for (
            let start = 0;
            start <= results.length - size;
            start++
        ) {

            const segment =
                results.slice(
                    start,
                    start + size
                );

            const severitySum =
                segment.reduce(
                    (sum, result) =>
                        sum +
                        issueSeverity(result),
                    0
                );

            const averageSeverity =
                severitySum /
                size;

            /*
             * Prefer concentrated problem areas rather than
             * sprawling sections with the same average.
             */
            const compactnessBonus =
                (maxWindow - size) * 2;

            const score =
                averageSeverity +
                compactnessBonus;

            if (
                !best ||
                score > best.score
            ) {
                best = {
                    score,
                    startIndex: start,
                    endIndex:
                        start + size - 1,
                    segment,
                    averageSeverity
                };
            }
        }
    }

    if (!best) {
        return null;
    }

    /*
     * If the phrase was nearly perfect, still offer a short
     * polish loop instead of pretending there is a major weakness.
     */
    return {
        startIndex:
            best.startIndex,
        endIndex:
            best.endIndex,
        startNote:
            results[
                best.startIndex
            ].expected.pitch,
        endNote:
            results[
                best.endIndex
            ].expected.pitch,
        issue:
            dominantIssue(
                best.segment
            ),
        speed:
            recommendedSpeedFor(
                best.segment
            ),
        severity:
            best.averageSeverity
    };
}


function updatePracticeLoopRecommendation(
    results
) {

    recommendedLoop =
        findRecommendedLoop(
            results
        );

    if (!recommendedLoop) {
        return;
    }

    highlightRecommendedLoopOnTimeline();

    document.getElementById(
        "loop-start-note"
    ).textContent =
        `${recommendedLoop.startIndex + 1}. ${recommendedLoop.startNote}`;

    document.getElementById(
        "loop-end-note"
    ).textContent =
        `${recommendedLoop.endIndex + 1}. ${recommendedLoop.endNote}`;

    document.getElementById(
        "loop-speed"
    ).textContent =
        recommendedLoop.speed;

    document.getElementById(
        "loop-issue"
    ).textContent =
        recommendedLoop.issue;

    const badge =
        document.getElementById(
            "practice-loop-badge"
        );

    const message =
        document.getElementById(
            "practice-loop-message"
        );

    if (
        recommendedLoop.severity <
        10
    ) {
        badge.textContent =
            "Polish section";

        message.textContent =
            `The performance is already strong, so this is a short section to polish: notes ${recommendedLoop.startIndex + 1}–${recommendedLoop.endIndex + 1}.`;

    } else {

        badge.textContent =
            "Weakest section";

        message.textContent =
            `I recommend looping notes ${recommendedLoop.startIndex + 1}–${recommendedLoop.endIndex + 1}. The main issue in this section is ${recommendedLoop.issue.toLowerCase()}, so start at ${recommendedLoop.speed} speed.`;
    }
}


function clearLoopHighlight() {

    document
        .querySelectorAll(
            "#results-body tr"
        )
        .forEach(row =>
            row.classList.remove(
                "practice-loop-row"
            )
        );
}


function applyRecommendedLoop() {

    clearLoopHighlight();

    if (!recommendedLoop) {
        return;
    }

    highlightRecommendedLoopOnTimeline();

    const rows =
        Array.from(
            document.querySelectorAll(
                "#results-body tr"
            )
        );

    for (
        let index =
            recommendedLoop.startIndex;
        index <=
            recommendedLoop.endIndex;
        index++
    ) {

        rows[
            index
        ]?.classList.add(
            "practice-loop-row"
        );
    }

    document.getElementById(
        "practice-loop-message"
    ).textContent =
        `Practice loop selected: notes ${recommendedLoop.startIndex + 1}–${recommendedLoop.endIndex + 1} at ${recommendedLoop.speed}. In the main tutorial, this will become the same loop region used by the drag-to-loop player.`;
}


function renderResults(
    results
) {

    currentResults =
        results;

    const summary =
        calculateSummary(
            results
        );

    [
        [
            "note-score",
            summary.noteAccuracy
        ],
        [
            "tuning-score",
            summary.tuning
        ],
        [
            "timing-score",
            summary.timing
        ],
        [
            "duration-score",
            summary.duration
        ]
    ].forEach(
        ([id, value]) => {

            const element =
                document.getElementById(
                    id
                );

            element.textContent =
                `${value}%`;

            element.className =
                `summary-value ${scoreClass(
                    value
                )}`;
        }
    );

    const overall =
        document.getElementById(
            "overall-score"
        );

    overall.textContent =
        `${summary.overall}%`;

    overall.className =
        `overall-score ${scoreClass(
            summary.overall
        )}`;

    document.getElementById(
        "overall-copy"
    ).textContent =
        summary.overall >= 90
            ? "Excellent control across this tutorial."
            : summary.overall >= 75
                ? "A strong attempt with a few areas to tighten."
                : summary.overall >= 60
                    ? "Some solid foundations, with clear areas to practise."
                    : "Useful attempt — the analysis below shows where to focus.";

    const wrong =
        results.filter(
            result =>
                !result.correct
        );

    const weak =
        results.filter(
            result =>
                weaknessFor(
                    result
                ) !==
                "Good"
        );

    const meanTiming =
        results.reduce(
            (
                sum,
                result
            ) =>
                sum +
                result.timingError,
            0
        ) /
        results.length;

    const meanDuration =
        results.reduce(
            (
                sum,
                result
            ) =>
                sum +
                (
                    (
                        result.heldDuration -
                        result.expected.duration
                    ) /
                    result.expected.duration
                ),
            0
        ) /
        results.length;

    let coaching =
        `<strong>${
            summary.overall >= 75
                ? "Good progress."
                : "You're getting there."
        }</strong> ` +
        `You scored ${summary.noteAccuracy}% for note accuracy, ` +
        `${summary.tuning}% for tuning, ${summary.timing}% for timing ` +
        `and ${summary.duration}% for note length. `;

    if (wrong.length) {
        coaching +=
            `Wrong notes were detected at positions ${wrong.map(
                result =>
                    result.index + 1
            ).join(", ")}. `;
    }

    if (meanTiming > 0.08) {
        coaching +=
            "You tend to enter notes late. ";
    } else if (meanTiming < -0.08) {
        coaching +=
            "You tend to enter notes early. ";
    }

    if (meanDuration < -0.08) {
        coaching +=
            "You tend to release notes too early. ";
    } else if (meanDuration > 0.08) {
        coaching +=
            "You tend to hold notes too long. ";
    }

    if (weak.length) {
        coaching +=
            `A good practice loop would focus on note positions ${weak.map(
                result =>
                    result.index + 1
            ).join(", ")}.`;
    }

    document.getElementById(
        "coaching"
    ).innerHTML =
        coaching;

    updatePracticeLoopRecommendation(
        results
    );

    const body =
        document.getElementById(
            "results-body"
        );

    body.innerHTML = "";

    results.forEach(
        result => {

            const row =
                document.createElement(
                    "tr"
                );

            const tuning =
                result.correct
                    ? `${
                        result.cents >= 0
                            ? "+"
                            : ""
                    }${result.cents.toFixed(
                        1
                    )}c (${result.tuningScore}%)`
                    : "—";

            const holdDifference =
                result.heldDuration -
                result.expected.duration;

            row.innerHTML = `
                <td>${result.index + 1}</td>

                <td>
                    <span class="note-pill">
                        ${result.expected.pitch}
                    </span>
                </td>

                <td>
                    <span class="note-pill">
                        ${result.detectedNote}
                    </span>
                </td>

                <td class="${
                    result.correct
                        ? "good"
                        : "bad"
                }">
                    ${
                        result.correct
                            ? "✓ Correct"
                            : "✗ Wrong"
                    }
                </td>

                <td>${tuning}</td>

                <td>
                    ${
                        result.timingError >= 0
                            ? "+"
                            : ""
                    }${result.timingError.toFixed(
                        2
                    )}s
                    (${result.timing.score}%)
                    <br>
                    <small>
                        ${result.timing.label}
                    </small>
                </td>

                <td>
                    ${result.heldDuration.toFixed(
                        2
                    )}s / ${result.expected.duration.toFixed(
                        2
                    )}s
                    (${result.duration.score}%)
                    <br>
                    <small>
                        ${
                            holdDifference >= 0
                                ? "+"
                                : ""
                        }${holdDifference.toFixed(
                            2
                        )}s · ${result.duration.label}
                    </small>
                </td>

                <td class="${
                    weaknessFor(
                        result
                    ) ===
                    "Good"
                        ? "good"
                        : "warn"
                }">
                    ${weaknessFor(
                        result
                    )}
                </td>
            `;

            body.appendChild(
                row
            );
        }
    );

    document.getElementById(
        "summary"
    ).style.display =
        "block";
}


document.addEventListener(
    "DOMContentLoaded",
    () => {

        document.getElementById(
            "load-file"
        ).addEventListener(
            "click",
            loadChosenFile
        );

        document.getElementById(
            "analyse-performance"
        ).addEventListener(
            "click",
            analysePerformance
        );

        document.getElementById(
            "apply-loop"
        ).addEventListener(
            "click",
            applyRecommendedLoop
        );

        document.getElementById(
            "clear-loop"
        ).addEventListener(
            "click",
            clearLoopHighlight
        );

        const practiceTimeline =
            document.getElementById(
                "practice-timeline-viewport"
            );

        practiceTimeline.addEventListener(
            "pointerdown",
            beginPracticeTimelineDrag
        );

        practiceTimeline.addEventListener(
            "pointermove",
            movePracticeTimelineDrag
        );

        practiceTimeline.addEventListener(
            "pointerup",
            endPracticeTimelineDrag
        );

        practiceTimeline.addEventListener(
            "pointercancel",
            endPracticeTimelineDrag
        );
    }
);
