export async function notificar(e, mensaje, bot = 'titiritero') {
  try {
    const token = bot === 'payment'
      ? e.telegram_payment_bot
      : e.telegram_titiritero_bot;
    const chatId = e.chat_ID_telegram;
    if (!token || !chatId) return false;
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: mensaje,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
    const d = await r.json();
    return d.ok === true;
  } catch (x) {
    return false;
  }
}
