/*
 * YourMusicTutorial - Full Coaching Scorecard v1
 *
 * Combines all four scoring components:
 *  - note accuracy
 *  - tuning
 *  - timing
 *  - note duration
 *
 * Pitch is measured from the real Iowa Alto Sax WAV files.
 * Timing and duration are simulated controls for now.
 * Later microphone onset/note-off detection will replace them.
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

const PHRASE = [
    { pitch: "C4", start: 0.00, duration: 1.00 },
    { pitch: "D4", start: 1.00, duration: 1.00 },
    { pitch: "E4", start: 2.00, duration: 2.00 },
    { pitch: "F4", start: 4.00, duration: 1.00 },
    { pitch: "G4", start: 5.00, duration: 3.00 },
    { pitch: "F4", start: 8.00, duration: 1.00 },
    { pitch: "E4", start: 9.00, duration: 2.00 },
    { pitch: "D4", start: 11.00, duration: 1.00 },
    { pitch: "C4", start: 12.00, duration: 4.00 }
];

let audioContext = null;


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


function buildUI() {

    const grid =
        document.getElementById(
            "phrase-grid"
        );

    PHRASE.forEach(
        (item, index) => {

            const maxDuration =
                Math.max(
                    1,
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
                        Timing offset (seconds)
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
                        Held duration (expected ${item.duration.toFixed(2)}s)
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

            select.value =
                item.pitch;

            grid.appendChild(row);
        }
    );

    wireSliderPairs(
        ".timing-slider",
        ".timing-number"
    );

    wireSliderPairs(
        ".duration-slider",
        ".duration-number"
    );
}


function wireSliderPairs(
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


async function loadSample(noteName) {

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


function midiToNoteName(midi) {

    const names = [
        "C", "Db", "D", "Eb",
        "E", "F", "Gb", "G",
        "Ab", "A", "Bb", "B"
    ];

    const rounded =
        Math.round(midi);

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

        if (abs <= 5) {
            tuningScore =
                100;
        } else {
            tuningScore =
                Math.max(
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

    const button =
        document.getElementById(
            "analyse-performance"
        );

    const status =
        document.getElementById(
            "status"
        );

    const played =
        Array.from(
            document.querySelectorAll(
                ".played-select"
            )
        );

    const timings =
        Array.from(
            document.querySelectorAll(
                ".timing-number"
            )
        );

    const durations =
        Array.from(
            document.querySelectorAll(
                ".duration-number"
            )
        );

    const results = [];

    button.disabled =
        true;

    button.textContent =
        "Analysing...";

    try {

        for (
            let index = 0;
            index < PHRASE.length;
            index++
        ) {

            const expected =
                PHRASE[index];

            const playedNote =
                played[
                    index
                ].value;

            const timingError =
                parseFloat(
                    timings[
                        index
                    ].value
                ) || 0;

            const heldDuration =
                Math.max(
                    0.05,
                    parseFloat(
                        durations[
                            index
                        ].value
                    ) ||
                    expected.duration
                );

            status.textContent =
                `Analysing note ${index + 1}/${PHRASE.length}: ${playedNote}.wav`;

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

            const analysis =
                analyseBuffer(
                    buffer
                );

            const pitch =
                scorePitch(
                    expected.pitch,
                    analysis
                );

            const timing =
                scoreTiming(
                    timingError
                );

            const duration =
                scoreDuration(
                    expected.duration,
                    heldDuration
                );

            results.push({
                index,
                expected,
                timingError,
                heldDuration,
                ...pitch,
                timing,
                duration
            });
        }

        renderResults(
            results
        );

        status.textContent =
            "Full performance analysis complete.";

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


function generateCoaching(
    results,
    summary
) {

    const wrong =
        results.filter(
            result =>
                !result.correct
        );

    const poorTiming =
        results.filter(
            result =>
                result.timing.score <
                65
        );

    const poorDuration =
        results.filter(
            result =>
                result.duration.score <
                65
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

    const meanDurationRatio =
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

    let text = "";

    if (
        summary.overall >=
        90
    ) {
        text +=
            "<strong>Excellent run.</strong> ";
    } else if (
        summary.overall >=
        75
    ) {
        text +=
            "<strong>Good progress.</strong> ";
    } else if (
        summary.overall >=
        60
    ) {
        text +=
            "<strong>You're getting there.</strong> ";
    } else {
        text +=
            "<strong>This phrase needs some focused practice.</strong> ";
    }

    text +=
        `You scored ${summary.noteAccuracy}% for note accuracy, ${summary.tuning}% for tuning, ${summary.timing}% for timing and ${summary.duration}% for note length. `;

    if (wrong.length) {
        text +=
            `Wrong notes were detected at positions ${wrong.map(
                result =>
                    result.index + 1
            ).join(", ")}. `;
    } else {
        text +=
            "Every note was correct. ";
    }

    if (
        meanTiming >
        0.08
    ) {
        text +=
            "You tend to enter notes late. ";
    } else if (
        meanTiming <
        -0.08
    ) {
        text +=
            "You tend to enter notes early. ";
    }

    if (
        meanDurationRatio <
        -0.08
    ) {
        text +=
            "You also tend to release notes too early. ";
    } else if (
        meanDurationRatio >
        0.08
    ) {
        text +=
            "You also tend to hold notes too long. ";
    }

    const weakPositions =
        new Set();

    [
        ...wrong,
        ...poorTiming,
        ...poorDuration
    ].forEach(
        result =>
            weakPositions.add(
                result.index + 1
            )
    );

    if (
        weakPositions.size
    ) {
        text +=
            `A good practice loop would focus on note positions ${Array.from(
                weakPositions
            ).sort(
                (a, b) =>
                    a - b
            ).join(", ")}.`;
    } else {
        text +=
            "No individual note stands out as a major weakness.";
    }

    return text;
}


function weaknessFor(
    result
) {

    const problems = [];

    if (!result.correct) {
        problems.push(
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
        problems.push(
            result.cents < 0
                ? "Flat"
                : "Sharp"
        );
    }

    if (
        result.timing.score <
        65
    ) {
        problems.push(
            result.timing.label
        );
    }

    if (
        result.duration.score <
        65
    ) {
        problems.push(
            result.duration.label
        );
    }

    return problems.length
        ? problems.join(", ")
        : "Good";
}


function renderResults(
    results
) {

    const summary =
        calculateSummary(
            results
        );

    const metricValues = [
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
    ];

    metricValues.forEach(
        ([id, value]) => {

            const element =
                document.getElementById(
                    id
                );

            element.textContent =
                `${value}%`;

            element.className =
                `summary-value ${
                    scoreClass(
                        value
                    )
                }`;
        }
    );

    const overall =
        document.getElementById(
            "overall-score"
        );

    overall.textContent =
        `${summary.overall}%`;

    overall.className =
        `overall-score ${
            scoreClass(
                summary.overall
            )
        }`;

    document.getElementById(
        "overall-copy"
    ).textContent =
        summary.overall >= 90
            ? "Excellent control across the phrase."
            : summary.overall >= 75
                ? "A strong attempt with a few areas to tighten."
                : summary.overall >= 60
                    ? "Some solid foundations, with clear areas to practise."
                    : "Useful first attempt — the feedback below shows where to focus.";

    document.getElementById(
        "coaching"
    ).innerHTML =
        generateCoaching(
            results,
            summary
        );

    const body =
        document.getElementById(
            "results-body"
        );

    body.innerHTML =
        "";

    results.forEach(
        result => {

            const row =
                document.createElement(
                    "tr"
                );

            const tuningText =
                result.correct
                    ? `${
                        result.cents >=
                        0
                            ? "+"
                            : ""
                    }${result.cents.toFixed(
                        1
                    )}c (${result.tuningScore}%)`
                    : "—";

            const timingText =
                `${
                    result.timingError >=
                    0
                        ? "+"
                        : ""
                }${result.timingError.toFixed(
                    2
                )}s (${result.timing.score}%)`;

            const holdDifference =
                result.heldDuration -
                result.expected.duration;

            const holdText =
                `${result.heldDuration.toFixed(
                    2
                )}s / ${result.expected.duration.toFixed(
                    2
                )}s (${result.duration.score}%)`;

            const weakness =
                weaknessFor(
                    result
                );

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

                <td>
                    ${tuningText}
                </td>

                <td>
                    ${timingText}
                    <br>
                    <small>
                        ${result.timing.label}
                    </small>
                </td>

                <td>
                    ${holdText}
                    <br>
                    <small>
                        ${
                            holdDifference >=
                            0
                                ? "+"
                                : ""
                        }${holdDifference.toFixed(
                            2
                        )}s · ${result.duration.label}
                    </small>
                </td>

                <td class="${
                    weakness ===
                    "Good"
                        ? "good"
                        : "warn"
                }">
                    ${weakness}
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

        buildUI();

        document
            .getElementById(
                "analyse-performance"
            )
            .addEventListener(
                "click",
                analysePerformance
            );
    }
);
