export default async function handler(req, res) {
  // CORSヘッダー設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONSリクエスト（プリフライト）への対応
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      name,
      furigana,
      phone,
      email,
      zipcode,
      prefecture_code,
      address,
      notes,
    } = req.body;

    // ============================================================
    // MEDIA_NAME と MEDIA_KEY は Vercel の環境変数から取得
    // Vercel の Settings > Environment Variables に設定してください
    // MEDIA_NAME: iframe_test_4
    // MEDIA_KEY:  sk_live_a12... （確認中の値）
    // ============================================================
    const media_name = process.env.MEDIA_NAME;
    const media_key  = process.env.MEDIA_KEY;

    if (!media_name || !media_key) {
      return res.status(500).json({ error: '環境変数が設定されていません' });
    }

    const payload = {
      name,
      furigana,
      phone,
      email,
      zipcode,
      prefecture_code,
      address,
      notes,
      media_name,
      media_key,
    };

    const response = await fetch('https://rehome-navi.com/api/package_estimates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    /* エラー内容をログ出力 */
    console.log('送信データ:', JSON.stringify(payload));
    console.log('APIレスポンスステータス:', response.status);
    console.log('APIレスポンスボディ:', JSON.stringify(data));

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error_message || 'APIエラーが発生しました',
      });
    }

    return res.status(200).json({ success: true, estimates_id: data.estimates_id });

  } catch (error) {
    console.error('submit error:', error);
    return res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}
