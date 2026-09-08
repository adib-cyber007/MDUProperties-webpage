'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramBot, parsePrice, plainTextToHtml } = require('../telegram-bot');

const OWNER_ID = '123456789';

function messageUpdate(updateId, text, extra = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: Number(OWNER_ID), first_name: 'Owner' },
      chat: { id: Number(OWNER_ID), type: 'private' },
      ...(text === undefined ? {} : { text }),
      ...extra
    }
  };
}

function callbackUpdate(updateId, data) {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from: { id: Number(OWNER_ID), first_name: 'Owner' },
      message: { message_id: updateId, chat: { id: Number(OWNER_ID), type: 'private' } },
      data
    }
  };
}

function fixture(initialListings = []) {
  let state = { conversation: null, lastUpdateId: 0 };
  let listings = structuredClone(initialListings);
  const telegramCalls = [];
  const created = [];
  const updated = [];
  const deleted = [];
  const progress = [];

  const bot = createTelegramBot({
    token: 'test-token',
    ownerId: OWNER_ID,
    telegramRequest: async (method, payload) => {
      telegramCalls.push({ method, payload });
      return method === 'getFile' ? { file_path: 'photo.jpg' } : true;
    },
    downloadImage: async message => `data:image/jpeg;base64,photo-${message.message_id}`,
    loadState: async () => structuredClone(state),
    saveState: async (_ownerId, next) => { state = structuredClone(next); },
    listListings: async () => structuredClone(listings),
    createListing: async input => {
      const listing = { ...structuredClone(input), id: 'created-listing' };
      listings.unshift(listing);
      created.push(listing);
      return structuredClone(listing);
    },
    updateListing: async (id, patch) => {
      const index = listings.findIndex(item => item.id === id);
      listings[index] = { ...listings[index], ...structuredClone(patch), updatedAt: '2026-09-09T00:00:00.000Z' };
      updated.push({ id, patch: structuredClone(patch) });
      return structuredClone(listings[index]);
    },
    deleteListing: async id => {
      listings = listings.filter(item => item.id !== id);
      deleted.push(id);
    },
    addProgress: async (id, item) => {
      progress.push({ id, item: structuredClone(item) });
      return true;
    }
  });

  return { bot, created, deleted, progress, telegramCalls, updated, getState: () => state, getListings: () => listings };
}

test('price parsing accepts rupees, lakhs, and crores', () => {
  assert.equal(parsePrice('4500000'), 4500000);
  assert.equal(parsePrice('45 L'), 4500000);
  assert.equal(parsePrice('2.85 Cr'), 28500000);
  assert.ok(Number.isNaN(parsePrice('call for price')));
});

test('plain Telegram descriptions become safe website paragraphs', () => {
  assert.equal(plainTextToHtml('First <home>\n\nSecond & final'), '<p>First &lt;home&gt;</p><p>Second &amp; final</p>');
});

test('the private bot ignores every non-owner update', async () => {
  const setup = fixture();
  const update = messageUpdate(1, '/mylistings');
  update.message.from.id = 999;
  update.message.chat.id = 999;
  assert.deepEqual(await setup.bot.handleUpdate(update), { ignored: true });
  assert.equal(setup.telegramCalls.length, 0);
  assert.equal(setup.getState().lastUpdateId, 0);
});

test('new listing conversation collects fields and publishes once', async () => {
  const setup = fixture();
  const updates = [
    messageUpdate(1, '/newlisting'),
    messageUpdate(2, 'Palm Court'),
    messageUpdate(3, '1,850 sq.ft'),
    messageUpdate(4, 'Anna Nagar, Madurai'),
    messageUpdate(5, '85 L'),
    callbackUpdate(6, 'new:status:construction'),
    messageUpdate(7, 'A bright family home.\n\nCompletion expected soon.'),
    messageUpdate(8, undefined, { photo: [{ file_id: 'main', width: 1280, height: 960 }] }),
    messageUpdate(9, 'done'),
    callbackUpdate(10, 'new:zoom:yes'),
    callbackUpdate(11, 'new:badge:direct'),
    callbackUpdate(12, 'new:progress:no'),
    callbackUpdate(13, 'new:confirm')
  ];
  for (const update of updates) await setup.bot.handleUpdate(update);

  assert.equal(setup.created.length, 1);
  assert.equal(setup.created[0].title, 'Palm Court');
  assert.equal(setup.created[0].price, 8500000);
  assert.equal(setup.created[0].status, 'construction');
  assert.equal(setup.created[0].trustBadge, 'direct');
  assert.equal(setup.created[0].mainImage, 'data:image/jpeg;base64,photo-8');
  assert.deepEqual(setup.created[0].gallery, []);
  assert.equal(setup.created[0].address, 'Anna Nagar, Madurai');
  assert.equal(setup.getState().conversation, null);

  await setup.bot.handleUpdate(callbackUpdate(13, 'new:confirm'));
  assert.equal(setup.created.length, 1, 'duplicate Telegram updates must not publish twice');
});

test('edit listing updates the existing shared record', async () => {
  const setup = fixture([{
    id: 'max-towers', title: 'Max Towers', area: '1100 sq.ft', location: 'Vilangudi',
    address: 'Vilangudi', mapPin: 'Vilangudi', price: 4500000, status: 'ready',
    description: '<p>Existing</p>', mainImage: 'https://example.com/main.jpg', gallery: [],
    zoomEnabled: true, trustBadge: 'verified', featured: true, progress: []
  }]);

  await setup.bot.handleUpdate(messageUpdate(1, '/editlisting'));
  await setup.bot.handleUpdate(callbackUpdate(2, 'edit:pick:0'));
  await setup.bot.handleUpdate(callbackUpdate(3, 'edit:field:price'));
  await setup.bot.handleUpdate(messageUpdate(4, '52 L'));

  assert.deepEqual(setup.updated[0], { id: 'max-towers', patch: { price: 5200000 } });
  assert.equal(setup.getListings()[0].price, 5200000);
  assert.equal(setup.getState().conversation.step, 'menu');
});

test('new-listing edit menu returns to the draft summary without discarding it', async () => {
  const setup = fixture();
  await setup.bot.handleUpdate(messageUpdate(1, '/newlisting'));
  await setup.bot.handleUpdate(messageUpdate(2, 'Draft Home'));
  const state = setup.getState();
  state.conversation.step = 'summary';
  await setup.bot.handleUpdate(callbackUpdate(3, 'new:edit-menu'));
  await setup.bot.handleUpdate(callbackUpdate(4, 'new:back-summary'));
  assert.equal(setup.getState().conversation.step, 'summary');
  assert.equal(setup.getState().conversation.draft.title, 'Draft Home');
  assert.equal(setup.created.length, 0);
});

test('delete listing requires an explicit confirmation callback', async () => {
  const setup = fixture([{
    id: 'max-towers', title: 'Max Towers', price: 4500000, status: 'ready',
    mainImage: 'https://example.com/main.jpg', gallery: [], progress: []
  }]);
  await setup.bot.handleUpdate(messageUpdate(1, '/deletelisting'));
  await setup.bot.handleUpdate(callbackUpdate(2, 'delete:pick:0'));
  assert.deepEqual(setup.deleted, []);
  await setup.bot.handleUpdate(callbackUpdate(3, 'delete:confirm:yes'));
  assert.deepEqual(setup.deleted, ['max-towers']);
});

test('add progress sends a dated photo to the existing listing service', async () => {
  const setup = fixture([{
    id: 'build-one', title: 'Build One', price: 7500000, status: 'construction',
    mainImage: 'https://example.com/main.jpg', gallery: [], progress: []
  }]);
  await setup.bot.handleUpdate(messageUpdate(1, '/addprogress'));
  await setup.bot.handleUpdate(callbackUpdate(2, 'progress:pick:0'));
  await setup.bot.handleUpdate(callbackUpdate(3, 'progress:stage:Structure'));
  await setup.bot.handleUpdate(messageUpdate(4, undefined, { photo: [{ file_id: 'progress', width: 1280, height: 960 }] }));

  assert.equal(setup.progress.length, 1);
  assert.equal(setup.progress[0].id, 'build-one');
  assert.equal(setup.progress[0].item.stage, 'Structure');
  assert.match(setup.progress[0].item.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(setup.progress[0].item.image, 'data:image/jpeg;base64,photo-4');
});
