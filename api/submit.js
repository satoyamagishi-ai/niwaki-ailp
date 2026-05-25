export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      name, furigana, phone, email, zipcode,
      prefecture_code, address, notes,
      photos, needs_slack
    } = req.body;

    const media_name    = process.env.MEDIA_NAME;
    const media_key     = process.env.MEDIA_KEY;
    const slack_webhook   = 'https://hooks.slack.com/services/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';
    const spreadsheet_url = process.env.spreadsheet_url;

    /* Cloudinary設定 */
    const CLOUD_NAME = 'dekvyywbw';
    const API_KEY    = '888714669159847';
    const API_SECRET = 'WrtRES7hssIUUfbedNgWnx3-xF8';

    if (!media_name || !media_key) {
      return res.status(500).json({ error: '環境変数が設定されていません' });
    }

    /* ① Cloudinaryに写真をアップロード → URLを取得 */
    const uploadedUrls = [];
    if (needs_slack === 'true' && photos && photos.length > 0) {
      for (const photoBase64 of photos) {
        if (!photoBase64) continue;
        try {
          /* Cloudinary署名生成 */
          const timestamp = Math.round(Date.now() / 1000);
          const folder    = 'niwaki';

          /* 署名文字列 */
          const sigStr = `folder=${folder}&timestamp=${timestamp}${API_SECRET}`;

          /* SHA1ハッシュ（Web Crypto API使用） */
          const encoder = new TextEncoder();
          const data = encoder.encode(sigStr);
          const hashBuffer = await crypto.subtle.digest('SHA-1', data);
          const hashArray  = Array.from(new Uint8Array(hashBuffer));
          const signature  = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

          /* Cloudinary APIにアップロード */
          const formData = new URLSearchParams();
          formData.append('file',      photoBase64);
          formData.append('timestamp', timestamp);
          formData.append('api_key',   API_KEY);
          formData.append('signature', signature);
          formData.append('folder',    folder);

          const uploadRes = await fetch(
            `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
            { method: 'POST', body: formData }
          );
          const uploadData = await uploadRes.json();
          if (uploadData.secure_url) {
            uploadedUrls.push(uploadData.secure_url);
          }
        } catch (e) {
          console.warn('Cloudinaryアップロードエラー:', e);
        }
      }
    }

    /* 郵便番号から都道府県コード・住所を補完（フロントで取得できなかった場合） */
    let finalPrefCode = prefecture_code;
    let finalAddress  = address;
    console.log('受信データ - zipcode:', zipcode, 'prefecture_code:', prefecture_code, 'address:', address);
    if (!finalPrefCode && zipcode) {
      try {
        const zipRes  = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zipcode}`);
        const zipData = await zipRes.json();
        console.log('zipcloudレスポンス:', JSON.stringify(zipData));
        if (zipData.results && zipData.results[0]) {
          const r = zipData.results[0];
          finalPrefCode = r.prefcode;
          if (!finalAddress) {
            finalAddress = r.address1 + r.address2 + r.address3;
          }
        }
      } catch(e) {
        console.warn('郵便番号API エラー:', e);
      }
    }
    console.log('最終データ - prefecture_code:', finalPrefCode, 'address:', finalAddress);

    /* ② リショップナビAPIにPOST */
    const payload = {
      name, furigana, phone, email,
      zipcode, prefecture_code: finalPrefCode, address: finalAddress, notes,
      media_name, media_key
    };

    /* ③ Slack通知（リショップナビAPIの結果に関係なく送信） */
    if (needs_slack === 'true' && slack_webhook) {
      const workLine  = notes.split('\n')[0].replace('作業内容：', '');
      const taiouLine = notes.split('\n').find(function(l) { return l.startsWith('対応希望：'); }) || '';

      const slackText = [
        '<@U051ELU7ETV>',
        '【庭木】問い合わせがありました。',
        `氏名：${name}（${furigana}）`,
        `作業内容：${workLine}`,
        taiouLine ? taiouLine : '',
        uploadedUrls.length > 0 ? `ファイル数：${uploadedUrls.length}枚` : '',
      ].filter(Boolean).join('\n');

      const attachments = uploadedUrls.map((url, i) => ({
        fallback: `写真${i + 1}`,
        image_url: url,
        title: `写真 ${i + 1}`,
      }));

      const slackRes = await fetch(slack_webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: slackText,
          attachments: attachments.length > 0 ? attachments : undefined,
        }),
      }).catch(function(e) { console.warn('Slack通知エラー:', e); });
      console.log('Slackステータス:', slackRes ? slackRes.status : 'error');
      const slackBody = slackRes ? await slackRes.text() : '';
      console.log('Slackレスポンス:', slackBody);
    }

    /* ④ スプレッドシートに記録（リショップナビAPIの結果に関係なく送信） */
    if (spreadsheet_url) {
      await fetch(spreadsheet_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, furigana, phone, email,
          zipcode, address, notes,
          photo_urls: uploadedUrls,
        }),
      }).catch(function(e) { console.warn('スプレッドシート記録エラー:', e); });
    }

    const response = await fetch('https://rehome-navi.com/api/package_estimates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    console.log('APIステータス:', response.status);
    console.log('APIレスポンス:', JSON.stringify(data));

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
