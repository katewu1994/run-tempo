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

---

## 日本語 (Japanese)

皆さん、こんにちは。まず、ランナーなら誰もが知っている課題からお話しします。

走るとき、「ケイデンス」、つまり歩数のテンポがとても重要です。コーチは1分間におよそ180歩を目安にします。適切なケイデンスは、ケガを減らし、効率の良い走りにつながるからです。そして、そのテンポを保つ一番簡単な方法は、一定のビートのある音楽、いわばメトロノーム入りの音楽に合わせて走ることです。

では今、ランナーはその音楽をどこで手に入れているでしょうか。ほとんどの場合、ネット上で「誰かが作った」音源をダウンロードしています。それが現実的な唯一の選択肢なんです。なぜなら、自分で作るのは本当に大変だからです。曲のテンポを検出して、メトロノームをビートに合わせて、速度を調整して、ミックスして書き出す——これは本格的なオーディオ編集の作業です。

しかも、既製の音源を見つけても、それは「固定」されています。あなたのトレーニング内容を知りません。ウォームアップ、テンポ走、クールダウンは、それぞれ違うケイデンスと違うエネルギーが必要です。でもダウンロードしたファイルは、あなたの練習の目的に合わせて変化できないのです。

この課題を解決するために作ったのが、**Run Tempo** です。

Run Tempo では、自分の好きな音楽を持ち込めます。ランニングプラン——ウォームアップ、テンポ、クールダウン——を選ぶと、アプリがセグメントごとに、ケイデンスに合わせたミックスを自動で組み立てます。

ここが設計のポイントです。私たちは処理を二つに分けました。ブラウザ側が、BPMの検出、ケイデンスの調整、ビートの同期、ミックスの生成といった「正確な計算」をすべてローカルで行います。だから音源は端末から外に出ず、数値も常に正確です。そして **GPT-5.6 Terra** は「音楽ディレクター」の役割を担います。ランニングの各セグメントに対して、どの曲が最も合うかをランク付けして選びます。テンポとエネルギーを合わせ、ウォームアップは穏やかに、ラストは力強く——そして、その理由も説明します。

つまり、GPT-5.6 Terra が音楽的なセンスを、ブラウザが正確さを担当し、あなたはワンクリックで自分だけのランニングミックスを手に入れられます。

あなたの音楽で、あなたのケイデンスで、あなたの走りを。ご清聴ありがとうございました。
