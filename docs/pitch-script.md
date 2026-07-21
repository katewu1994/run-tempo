# Run Tempo — Pitch Scripts (2–3 min)

## English

Hi everyone. Let me start with a problem every runner knows.

When you run, your cadence matters. Coaches aim for around 180 steps per minute, because the right cadence means fewer injuries and a more efficient stride. And the easiest way to hold that cadence is to run to music with a steady beat — basically, music with a built-in metronome.

So where do runners get that music today? They go online and download audio that *someone else* already made. That's the only realistic option, because making it yourself is genuinely hard. You'd have to detect the song's tempo, line up a metronome to the beat, adjust the speed, and mix and export it — that's serious audio engineering.

And even when you find a pre-made track, it's fixed. It doesn't know your workout. A warm-up, a tempo push, and a cool-down all need different cadences and different energy — but a downloaded file can't adapt to your training goal.

That's the gap we built **Run Tempo** to close.

With Run Tempo, you bring your *own* music. You pick a running plan — warm up, tempo, cool down. And the app builds a cadence-locked mix for you, segment by segment.

Here's the key design idea. We split the work in two. The browser does all the precise audio math locally — detecting BPM, matching cadence, syncing the beat, and rendering the mix — so your files never leave your device, and every number is exact. And **GPT-5.6 Terra** acts as the music director: for each segment of your run, it ranks and selects which of your tracks fits best — matching tempo and energy, calmer for the warm-up, intense for the finish — and explains why.

So GPT-5.6 Terra brings the musical taste, the browser brings the precision, and you get a personalized running mix in one click.

Your music, your cadence, your run. Thank you.
