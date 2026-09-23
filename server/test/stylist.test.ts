import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, test } from 'node:test';
import { stylistChat, withoutEmoji } from '../src/ai/stylistChat';
import { loadConfig } from '../src/config';

describe('Jev writes without emoji', () => {
  test('removes pictographs and emoji sequences, keeps Turkish text and punctuation', () => {
    assert.equal(withoutEmoji('Harika bir otorite dengesi kuruyor ✨'), 'Harika bir otorite dengesi kuruyor');
    assert.equal(withoutEmoji('Bu akşam 🍷 için şık ol!'), 'Bu akşam için şık ol!');
    assert.equal(withoutEmoji('Selam 👋🏽 nereye gidiyorsun 🙂?'), 'Selam nereye gidiyorsun?');
    assert.equal(withoutEmoji('Aile 👨‍👩‍👧 buluşması, ❤️ kırmızı hırka'), 'Aile buluşması, kırmızı hırka');
    assert.equal(withoutEmoji('Tatil 🇹🇷 havası'), 'Tatil havası');
    assert.equal(withoutEmoji('Çağla, ışık, ölçü: 3 parça.'), 'Çağla, ışık, ölçü: 3 parça.');
  });

  test('a chat reply from the model reaches the app without emoji', async () => {
    const provider = http.createServer((_req, res) => {
      const content = JSON.stringify({
        intent: 'chat',
        reply: 'Merhaba! 👋 Bu akşam nereye gidiyorsun? ✨',
        brief: '',
        occasion: 'casual',
        mustIncludeIds: [],
        avoidIds: [],
        skipSlots: [],
        keepFromCurrentIds: [],
      });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content } }], usage: { cost: 0 } }));
    });
    await new Promise<void>((resolve) => provider.listen(0, resolve));
    try {
      const config = loadConfig({ openRouterKey: 'test-key', openRouterBase: `http://127.0.0.1:${(provider.address() as AddressInfo).port}` });
      const result = await stylistChat(config, { messages: [{ role: 'user', text: 'selam' }], lang: 'tr', garments: [], userId: 'u_test' });
      assert.equal(result.intent, 'chat');
      assert.equal(result.reply, 'Merhaba! Bu akşam nereye gidiyorsun?');
    } finally {
      provider.close();
    }
  });
});
