'use strict';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_DRAFT_BYTES = 24 * 1024 * 1024;

function button(text, callbackData) {
  return { text, callback_data: callbackData };
}

function keyboard(rows) {
  return { inline_keyboard: rows };
}

function sendMessage(text, replyMarkup) {
  return {
    method: 'sendMessage',
    payload: {
      text: String(text).slice(0, 4096),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    }
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function plainTextToHtml(value) {
  return String(value || '').trim().split(/\n{2,}/).filter(Boolean)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
}

function stripHtml(value) {
  return String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function parsePrice(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/₹/g, '').replace(/,/g, '');
  const match = raw.match(/^\s*(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lac|lakh|lakhs)?\s*$/i);
  if (!match) return NaN;
  const amount = Number(match[1]);
  const unit = (match[2] || '').toLowerCase();
  if (['cr', 'crore', 'crores'].includes(unit)) return Math.round(amount * 10000000);
  if (['l', 'lac', 'lakh', 'lakhs'].includes(unit)) return Math.round(amount * 100000);
  return Math.round(amount);
}

function formatPrice(value) {
  const amount = Number(value) || 0;
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2).replace(/\.00$/, '')} L`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

function statusLabel(value) {
  return value === 'construction' ? 'Under Construction' : 'Ready for Sale';
}

function badgeLabel(value) {
  if (value === 'verified') return 'Verified Listing';
  if (value === 'direct') return 'Direct from Builder';
  return 'No badge';
}

function shortText(value, max = 500) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function listingSummary(listing, heading = 'Listing summary') {
  const description = shortText(stripHtml(listing.description), 700) || '—';
  return [
    heading,
    '',
    `Title: ${listing.title || '—'}`,
    `Area: ${listing.area || '—'}`,
    `Location: ${listing.location || '—'}`,
    `Price: ${Number.isFinite(Number(listing.price)) ? formatPrice(listing.price) : '—'}`,
    `Status: ${statusLabel(listing.status)}`,
    `Description: ${description}`,
    `Main photo: ${listing.mainImage ? 'Attached' : 'Missing'}`,
    `Gallery photos: ${(listing.gallery || []).length}`,
    `Gallery zoom: ${listing.zoomEnabled ? 'Enabled' : 'Disabled'}`,
    `Badge: ${badgeLabel(listing.trustBadge)}`,
    `Homepage featured: ${listing.featured ? 'Yes' : 'No'}`,
    `Progress updates: ${(listing.progress || []).length}`
  ].join('\n');
}

function homeKeyboard() {
  return keyboard([
    [button('➕ New listing', 'command:new'), button('✏️ Edit listing', 'command:edit')],
    [button('🏗 Add progress', 'command:progress'), button('📋 My listings', 'command:list')],
    [button('🗑 Delete listing', 'command:delete')]
  ]);
}

function cancelKeyboard() {
  return keyboard([[button('Cancel', 'cancel')]]);
}

function pickerKeyboard(prefix, listings) {
  const rows = listings.map((listing, index) => [button(`${index + 1}. ${shortText(listing.title, 42)}`, `${prefix}:pick:${index}`)]);
  rows.push([button('Cancel', 'cancel')]);
  return keyboard(rows);
}

function newSummaryKeyboard() {
  return keyboard([
    [button('✅ Publish listing', 'new:confirm')],
    [button('✏️ Edit a field', 'new:edit-menu'), button('Cancel', 'cancel')]
  ]);
}

function statusKeyboard(prefix) {
  return keyboard([[
    button('Under Construction', `${prefix}:construction`),
    button('Ready for Sale', `${prefix}:ready`)
  ], [button('Cancel', 'cancel')]]);
}

function yesNoKeyboard(prefix, includeCancel = true) {
  const rows = [[button('Yes', `${prefix}:yes`), button('No', `${prefix}:no`)]];
  if (includeCancel) rows.push([button('Cancel', 'cancel')]);
  return keyboard(rows);
}

function badgeKeyboard(prefix) {
  return keyboard([
    [button('Verified Listing', `${prefix}:verified`), button('Direct from Builder', `${prefix}:direct`)],
    [button('No badge', `${prefix}:none`), button('Cancel', 'cancel')]
  ]);
}

function stageKeyboard(prefix) {
  return keyboard([
    [button('Foundation', `${prefix}:Foundation`), button('Structure', `${prefix}:Structure`)],
    [button('Finishing', `${prefix}:Finishing`), button('Custom label', `${prefix}:custom`)],
    [button('Cancel', 'cancel')]
  ]);
}

function editFieldKeyboard(prefix = 'edit:field') {
  const doneCallback = prefix.startsWith('new:') ? 'new:back-summary' : 'edit:done';
  return keyboard([
    [button('Title', `${prefix}:title`), button('Area', `${prefix}:area`)],
    [button('Location', `${prefix}:location`), button('Price', `${prefix}:price`)],
    [button('Address', `${prefix}:address`), button('Map pin', `${prefix}:mapPin`)],
    [button('Status', `${prefix}:status`), button('Description', `${prefix}:description`)],
    [button('Main photo', `${prefix}:mainImage`), button('Gallery', `${prefix}:gallery`)],
    [button('Gallery zoom', `${prefix}:zoomEnabled`), button('Trust badge', `${prefix}:trustBadge`)],
    [button('Homepage featured', `${prefix}:featured`)],
    [button('Done', doneCallback), button('Cancel', 'cancel')]
  ]);
}

function helpText() {
  return [
    'Madurai Dream Properties bot',
    '',
    '/newlisting — publish a guided new listing',
    '/editlisting — change any existing listing field',
    '/addprogress — add a construction progress photo',
    '/deletelisting — delete a listing with confirmation',
    '/mylistings — show all live listings',
    '/cancel — stop the current conversation',
    '/help — show this menu',
    '',
    'Only the configured owner account can use this bot.'
  ].join('\n');
}

function chunkListingActions(listings) {
  if (!listings.length) return [sendMessage('There are no live listings yet.', homeKeyboard())];
  const lines = listings.map((listing, index) => `${index + 1}. ${listing.title}\n   ${statusLabel(listing.status)} · ${formatPrice(listing.price)}\n   ${listing.location || 'Location not set'}`);
  const actions = [];
  let text = 'My live listings\n\n';
  for (const line of lines) {
    if ((text + line).length > 3900) {
      actions.push(sendMessage(text.trim()));
      text = '';
    }
    text += `${line}\n\n`;
  }
  actions.push(sendMessage(text.trim(), homeKeyboard()));
  return actions;
}

function draftDefaults() {
  return {
    title: '', area: '', location: '', address: '', mapPin: '', price: NaN,
    status: 'ready', trustBadge: '', description: '', mainImage: '', gallery: [],
    zoomEnabled: true, featured: false, progress: []
  };
}

function assertDraftSize(draft) {
  if (Buffer.byteLength(JSON.stringify(draft)) > MAX_DRAFT_BYTES) {
    throw new Error('The draft has reached the safe image limit. Remove some photos or send smaller images.');
  }
}

function fieldPrompt(field) {
  return {
    title: 'Send the new title.',
    area: 'Send the housing area, for example: 1100 sq.ft.',
    location: 'Send the new location.',
    address: 'Send the full property address.',
    mapPin: 'Send the map search text or map pin location.',
    price: 'Send the price in rupees, lakhs, or crores. Examples: 4500000, 45 L, 2.85 Cr.',
    description: 'Send the new description. Use a blank line between paragraphs.'
  }[field] || 'Send the new value.';
}

function valuePatch(field, text) {
  if (field === 'price') {
    const price = parsePrice(text);
    if (!Number.isFinite(price) || price < 0) throw new Error('That price was not understood. Try 4500000, 45 L, or 2.85 Cr.');
    return { price };
  }
  if (field === 'description') return { description: plainTextToHtml(text) };
  if (!String(text || '').trim()) throw new Error('This value cannot be empty.');
  return { [field]: String(text).trim() };
}

function chooseTelegramPhoto(message, maxWidth) {
  if (Array.isArray(message?.photo) && message.photo.length) {
    const ordered = [...message.photo].sort((a, b) => Number(a.width || 0) - Number(b.width || 0));
    const within = ordered.filter(photo => Number(photo.width || 0) <= maxWidth);
    const selected = within.at(-1) || ordered[0];
    return { fileId: selected.file_id, mimeType: 'image/jpeg', size: Number(selected.file_size || 0) };
  }
  if (message?.document?.file_id && String(message.document.mime_type || '').startsWith('image/')) {
    return {
      fileId: message.document.file_id,
      mimeType: message.document.mime_type,
      size: Number(message.document.file_size || 0)
    };
  }
  return null;
}

function createTelegramBot(options) {
  const token = String(options.token || '');
  const ownerId = String(options.ownerId || '');
  const telegramRequest = options.telegramRequest || (async (method, payload = {}) => {
    if (!token) throw new Error('Telegram bot token is not configured.');
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(`Telegram ${method} failed: ${data.description || response.status}`);
    return data.result;
  });

  const downloadImage = options.downloadImage || (async (message, maxWidth) => {
    const photo = chooseTelegramPhoto(message, maxWidth);
    if (!photo) throw new Error('Please send an image as a Telegram photo.');
    if (photo.size && photo.size > MAX_IMAGE_BYTES) throw new Error('That image is too large. Send it as a compressed Telegram photo under 4 MB.');
    const file = await telegramRequest('getFile', { file_id: photo.fileId });
    if (!file?.file_path) throw new Error('Telegram did not return an image file path. Please try the photo again.');
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!response.ok) throw new Error('Telegram could not download that image. Please try again.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('That image is too large. Send it as a compressed Telegram photo under 4 MB.');
    const mimeType = response.headers.get('content-type')?.split(';')[0] || photo.mimeType;
    if (!mimeType.startsWith('image/')) throw new Error('The received file is not an image.');
    return `data:${mimeType};base64,${bytes.toString('base64')}`;
  });

  function newSummary(state) {
    return {
      conversation: { ...state, step: 'summary' },
      actions: [sendMessage(listingSummary(state.draft, 'Review your new listing'), newSummaryKeyboard())]
    };
  }

  async function listingById(id) {
    const listings = await options.listListings();
    return listings.find(listing => listing.id === id) || null;
  }

  async function editResult(state, patch, confirmation) {
    const updated = await options.updateListing(state.listingId, patch);
    return {
      conversation: { flow: 'edit', step: 'menu', listingId: updated.id },
      actions: [sendMessage(`${confirmation}\n\n${listingSummary(updated, 'Current listing')}`, editFieldKeyboard())]
    };
  }

  async function handleCommand(command) {
    if (['/start', '/help'].includes(command)) return { conversation: null, actions: [sendMessage(helpText(), homeKeyboard())] };
    if (command === '/cancel') return { conversation: null, actions: [sendMessage('Conversation cancelled.', homeKeyboard())] };
    if (command === '/mylistings') return { conversation: null, actions: chunkListingActions(await options.listListings()) };
    if (command === '/newlisting') {
      return {
        conversation: { flow: 'new', step: 'title', draft: draftDefaults() },
        actions: [sendMessage('Let’s create a new listing.\n\n1/10 — Send the listing title.', cancelKeyboard())]
      };
    }
    if (command === '/editlisting') {
      const listings = await options.listListings();
      if (!listings.length) return { conversation: null, actions: [sendMessage('There are no listings to edit.', homeKeyboard())] };
      return {
        conversation: { flow: 'edit', step: 'pick', choices: listings.map(item => item.id) },
        actions: [sendMessage('Choose the listing to edit.', pickerKeyboard('edit', listings))]
      };
    }
    if (command === '/deletelisting') {
      const listings = await options.listListings();
      if (!listings.length) return { conversation: null, actions: [sendMessage('There are no listings to delete.', homeKeyboard())] };
      return {
        conversation: { flow: 'delete', step: 'pick', choices: listings.map(item => item.id) },
        actions: [sendMessage('Choose the listing to delete.', pickerKeyboard('delete', listings))]
      };
    }
    if (command === '/addprogress') {
      const listings = (await options.listListings()).filter(item => item.status === 'construction');
      if (!listings.length) return { conversation: null, actions: [sendMessage('There are no under-construction listings.', homeKeyboard())] };
      return {
        conversation: { flow: 'progress', step: 'pick', choices: listings.map(item => item.id) },
        actions: [sendMessage('Choose an under-construction listing.', pickerKeyboard('progress', listings))]
      };
    }
    return { conversation: null, actions: [sendMessage('Unknown command. Use /help to see the available commands.', homeKeyboard())] };
  }

  async function handleNewCallback(data, state) {
    const parts = data.split(':');
    if (data.startsWith('new:status:')) {
      state.draft.status = parts[2] === 'construction' ? 'construction' : 'ready';
      if (state.draft.status === 'ready') state.draft.progress = [];
      state.step = 'description';
      return { conversation: state, actions: [sendMessage('6/10 — Send the property description. Use a blank line between paragraphs.', cancelKeyboard())] };
    }
    if (data.startsWith('new:zoom:')) {
      state.draft.zoomEnabled = parts[2] === 'yes';
      state.step = 'badge';
      return { conversation: state, actions: [sendMessage('9/10 — Choose the trust badge.', badgeKeyboard('new:badge'))] };
    }
    if (data.startsWith('new:badge:')) {
      state.draft.trustBadge = ['verified', 'direct'].includes(parts[2]) ? parts[2] : '';
      if (state.draft.status === 'construction') {
        state.step = 'progress_prompt';
        return { conversation: state, actions: [sendMessage('10/10 — Add construction progress photos now?', yesNoKeyboard('new:progress'))] };
      }
      return newSummary(state);
    }
    if (data === 'new:progress:no') return newSummary(state);
    if (data === 'new:progress:yes') {
      state.step = 'progress_stage';
      return { conversation: state, actions: [sendMessage('Choose the construction stage label.', stageKeyboard('new:stage'))] };
    }
    if (data.startsWith('new:stage:')) {
      if (parts[2] === 'custom') {
        state.step = 'progress_stage_custom';
        return { conversation: state, actions: [sendMessage('Send the custom progress stage label.', cancelKeyboard())] };
      }
      state.progressStage = parts.slice(2).join(':');
      state.step = 'progress_photo';
      return { conversation: state, actions: [sendMessage(`Send the ${state.progressStage} progress photo. Today’s date will be used.`, cancelKeyboard())] };
    }
    if (data === 'new:progress-more:yes') {
      state.step = 'progress_stage';
      return { conversation: state, actions: [sendMessage('Choose the next construction stage.', stageKeyboard('new:stage'))] };
    }
    if (data === 'new:progress-more:no') return newSummary(state);
    if (data === 'new:confirm') {
      const created = await options.createListing({
        ...state.draft,
        address: state.draft.address || state.draft.location,
        mapPin: state.draft.mapPin || state.draft.location
      });
      return { conversation: null, actions: [sendMessage(`✅ ${created.title} is live now with its New Listing tag.`, homeKeyboard())] };
    }
    if (data === 'new:back-summary') return newSummary(state);
    if (data === 'new:edit-menu') {
      state.step = 'edit_menu';
      return { conversation: state, actions: [sendMessage('Choose the field to change before publishing.', editFieldKeyboard('new:edit'))] };
    }
    if (data.startsWith('new:edit:')) {
      const field = parts[2];
      if (['title', 'area', 'location', 'address', 'mapPin', 'price', 'description'].includes(field)) {
        state.step = 'edit_value';
        state.editField = field;
        return { conversation: state, actions: [sendMessage(fieldPrompt(field), cancelKeyboard())] };
      }
      if (field === 'status') return { conversation: state, actions: [sendMessage('Choose the status.', statusKeyboard('new:set:status'))] };
      if (field === 'zoomEnabled') return { conversation: state, actions: [sendMessage('Enable gallery zoom?', yesNoKeyboard('new:set:zoom'))] };
      if (field === 'trustBadge') return { conversation: state, actions: [sendMessage('Choose the trust badge.', badgeKeyboard('new:set:badge'))] };
      if (field === 'featured') return { conversation: state, actions: [sendMessage('Feature this listing on the homepage?', yesNoKeyboard('new:set:featured'))] };
      if (field === 'mainImage') {
        state.step = 'edit_main';
        return { conversation: state, actions: [sendMessage('Send the replacement main photo.', cancelKeyboard())] };
      }
      if (field === 'gallery') {
        state.step = 'edit_gallery';
        state.draft.gallery = [];
        return { conversation: state, actions: [sendMessage('Send replacement gallery photos one by one, then reply done. Reply skip for no gallery.', cancelKeyboard())] };
      }
    }
    if (data.startsWith('new:set:status:')) {
      state.draft.status = parts[3] === 'construction' ? 'construction' : 'ready';
      if (state.draft.status === 'ready') state.draft.progress = [];
      return newSummary(state);
    }
    if (data.startsWith('new:set:zoom:')) {
      state.draft.zoomEnabled = parts[3] === 'yes';
      return newSummary(state);
    }
    if (data.startsWith('new:set:badge:')) {
      state.draft.trustBadge = ['verified', 'direct'].includes(parts[3]) ? parts[3] : '';
      return newSummary(state);
    }
    if (data.startsWith('new:set:featured:')) {
      state.draft.featured = parts[3] === 'yes';
      return newSummary(state);
    }
    return { conversation: state, actions: [sendMessage('That option is no longer active. Use /newlisting to restart.')] };
  }

  async function handleNewMessage(message, state) {
    const text = String(message.text || '').trim();
    if (state.step === 'title') {
      if (!text) throw new Error('Send a title as text.');
      state.draft.title = text;
      state.step = 'area';
      return { conversation: state, actions: [sendMessage('2/10 — Send the housing area, for example: 1100 sq.ft.', cancelKeyboard())] };
    }
    if (state.step === 'area') {
      if (!text) throw new Error('Send the housing area as text.');
      state.draft.area = text;
      state.step = 'location';
      return { conversation: state, actions: [sendMessage('3/10 — Send the property location.', cancelKeyboard())] };
    }
    if (state.step === 'location') {
      if (!text) throw new Error('Send the location as text.');
      state.draft.location = text;
      state.draft.address = text;
      state.draft.mapPin = text;
      state.step = 'price';
      return { conversation: state, actions: [sendMessage('4/10 — Send the price. Examples: 4500000, 45 L, or 2.85 Cr.', cancelKeyboard())] };
    }
    if (state.step === 'price') {
      const price = parsePrice(text);
      if (!Number.isFinite(price) || price < 0) throw new Error('That price was not understood. Try 4500000, 45 L, or 2.85 Cr.');
      state.draft.price = price;
      state.step = 'status';
      return { conversation: state, actions: [sendMessage('5/10 — Choose the listing status.', statusKeyboard('new:status'))] };
    }
    if (state.step === 'description') {
      if (!text) throw new Error('Send the description as text.');
      state.draft.description = plainTextToHtml(text);
      state.step = 'main_image';
      return { conversation: state, actions: [sendMessage('7/10 — Send the main property photo.', cancelKeyboard())] };
    }
    if (state.step === 'main_image') {
      state.draft.mainImage = await downloadImage(message, 1900);
      assertDraftSize(state.draft);
      state.step = 'gallery';
      return { conversation: state, actions: [sendMessage('8/10 — Send gallery photos one by one. Reply done when finished, or skip.', cancelKeyboard())] };
    }
    if (state.step === 'gallery') {
      if (/^(done|skip)$/i.test(text)) {
        state.step = 'zoom';
        return { conversation: state, actions: [sendMessage('9/10 — Enable zoom on gallery images?', yesNoKeyboard('new:zoom'))] };
      }
      const image = await downloadImage(message, 1600);
      if (state.draft.gallery.length >= 16) throw new Error('The gallery already has the maximum of 16 photos. Reply done to continue.');
      state.draft.gallery.push(image);
      assertDraftSize(state.draft);
      return { conversation: state, actions: [sendMessage(`Gallery photo ${state.draft.gallery.length} added. Send another or reply done.`)] };
    }
    if (state.step === 'progress_stage_custom') {
      if (!text) throw new Error('Send the stage label as text.');
      state.progressStage = text.slice(0, 60);
      state.step = 'progress_photo';
      return { conversation: state, actions: [sendMessage(`Send the ${state.progressStage} progress photo. Today’s date will be used.`, cancelKeyboard())] };
    }
    if (state.step === 'progress_photo') {
      if (state.draft.progress.length >= 10) throw new Error('The listing already has the maximum of 10 progress updates.');
      const image = await downloadImage(message, 1400);
      state.draft.progress.push({ stage: state.progressStage, date: new Date().toISOString().slice(0, 10), image });
      delete state.progressStage;
      assertDraftSize(state.draft);
      state.step = 'progress_more';
      return { conversation: state, actions: [sendMessage('Progress photo added. Add another stage?', yesNoKeyboard('new:progress-more'))] };
    }
    if (state.step === 'edit_value') {
      Object.assign(state.draft, valuePatch(state.editField, text));
      delete state.editField;
      return newSummary(state);
    }
    if (state.step === 'edit_main') {
      state.draft.mainImage = await downloadImage(message, 1900);
      assertDraftSize(state.draft);
      return newSummary(state);
    }
    if (state.step === 'edit_gallery') {
      if (/^(done|skip)$/i.test(text)) return newSummary(state);
      const image = await downloadImage(message, 1600);
      if (state.draft.gallery.length >= 16) throw new Error('The gallery already has 16 photos. Reply done to continue.');
      state.draft.gallery.push(image);
      assertDraftSize(state.draft);
      return { conversation: state, actions: [sendMessage(`Gallery photo ${state.draft.gallery.length} added. Send another or reply done.`)] };
    }
    return { conversation: state, actions: [sendMessage('Please use the buttons shown for this step, or send /cancel.')] };
  }

  async function handleEditCallback(data, state) {
    const parts = data.split(':');
    if (data.startsWith('edit:pick:')) {
      const listingId = state.choices?.[Number(parts[2])];
      const listing = listingId && await listingById(listingId);
      if (!listing) return { conversation: null, actions: [sendMessage('That listing no longer exists.', homeKeyboard())] };
      return {
        conversation: { flow: 'edit', step: 'menu', listingId },
        actions: [sendMessage(listingSummary(listing, 'Choose what to edit'), editFieldKeyboard())]
      };
    }
    if (data === 'edit:done') return { conversation: null, actions: [sendMessage('Editing finished.', homeKeyboard())] };
    if (data.startsWith('edit:field:')) {
      const field = parts[2];
      if (['title', 'area', 'location', 'address', 'mapPin', 'price', 'description'].includes(field)) {
        return { conversation: { ...state, step: 'value', editField: field }, actions: [sendMessage(fieldPrompt(field), cancelKeyboard())] };
      }
      if (field === 'status') return { conversation: state, actions: [sendMessage('Choose the new status. Changing to Ready for Sale removes construction progress from the listing.', statusKeyboard('edit:set:status'))] };
      if (field === 'zoomEnabled') return { conversation: state, actions: [sendMessage('Enable gallery zoom?', yesNoKeyboard('edit:set:zoom'))] };
      if (field === 'trustBadge') return { conversation: state, actions: [sendMessage('Choose the trust badge.', badgeKeyboard('edit:set:badge'))] };
      if (field === 'featured') return { conversation: state, actions: [sendMessage('Feature this listing on the homepage?', yesNoKeyboard('edit:set:featured'))] };
      if (field === 'mainImage') return { conversation: { ...state, step: 'photo', editField: 'mainImage' }, actions: [sendMessage('Send the replacement main photo.', cancelKeyboard())] };
      if (field === 'gallery') {
        return {
          conversation: { ...state, step: 'gallery_mode' },
          actions: [sendMessage('How should the gallery change?', keyboard([
            [button('Add photos', 'edit:gallery:add'), button('Replace gallery', 'edit:gallery:replace')],
            [button('Clear gallery', 'edit:gallery:clear'), button('Cancel', 'cancel')]
          ]))]
        };
      }
    }
    if (data.startsWith('edit:set:status:')) return editResult(state, { status: parts[3] === 'construction' ? 'construction' : 'ready' }, 'Status updated.');
    if (data.startsWith('edit:set:zoom:')) return editResult(state, { zoomEnabled: parts[3] === 'yes' }, 'Gallery zoom updated.');
    if (data.startsWith('edit:set:badge:')) return editResult(state, { trustBadge: ['verified', 'direct'].includes(parts[3]) ? parts[3] : '' }, 'Trust badge updated.');
    if (data.startsWith('edit:set:featured:')) return editResult(state, { featured: parts[3] === 'yes' }, 'Homepage setting updated.');
    if (data === 'edit:gallery:add' || data === 'edit:gallery:replace') {
      if (data === 'edit:gallery:add') {
        const listing = await listingById(state.listingId);
        if ((listing?.gallery || []).length >= 16) {
          return { conversation: { ...state, step: 'menu' }, actions: [sendMessage('This gallery already has the maximum of 16 photos.', editFieldKeyboard())] };
        }
      }
      return {
        conversation: { ...state, step: 'gallery_collect', galleryMode: data.endsWith(':add') ? 'add' : 'replace', pendingGallery: [] },
        actions: [sendMessage('Send gallery photos one by one, then reply done.', cancelKeyboard())]
      };
    }
    if (data === 'edit:gallery:clear') {
      return {
        conversation: { ...state, step: 'gallery_clear_confirm' },
        actions: [sendMessage('Remove every gallery photo from this listing?', yesNoKeyboard('edit:gallery-clear'))]
      };
    }
    if (data === 'edit:gallery-clear:no') {
      const listing = await listingById(state.listingId);
      return { conversation: { ...state, step: 'menu' }, actions: [sendMessage(listingSummary(listing, 'No changes made'), editFieldKeyboard())] };
    }
    if (data === 'edit:gallery-clear:yes') return editResult(state, { gallery: [] }, 'Gallery cleared.');
    return { conversation: state, actions: [sendMessage('That edit option is no longer active. Use /editlisting to restart.')] };
  }

  async function handleEditMessage(message, state) {
    const text = String(message.text || '').trim();
    if (state.step === 'value') return editResult(state, valuePatch(state.editField, text), `${state.editField} updated.`);
    if (state.step === 'photo') return editResult(state, { mainImage: await downloadImage(message, 1900) }, 'Main photo updated.');
    if (state.step === 'gallery_collect') {
      if (/^done$/i.test(text)) {
        if (!state.pendingGallery.length) throw new Error('Send at least one photo before replying done, or use /cancel.');
        const current = await listingById(state.listingId);
        const available = Math.max(0, 16 - (current?.gallery || []).length);
        const gallery = state.galleryMode === 'add' ? [...(current?.gallery || []), ...state.pendingGallery.slice(0, available)] : state.pendingGallery.slice(0, 16);
        return editResult(state, { gallery }, 'Gallery updated.');
      }
      const image = await downloadImage(message, 1600);
      if (state.pendingGallery.length >= 16) throw new Error('You have selected the maximum of 16 photos. Reply done.');
      state.pendingGallery.push(image);
      assertDraftSize({ gallery: state.pendingGallery });
      return { conversation: state, actions: [sendMessage(`Photo ${state.pendingGallery.length} added. Send another or reply done.`)] };
    }
    return { conversation: state, actions: [sendMessage('Choose an edit field with the buttons, or send /cancel.')] };
  }

  async function handleDeleteCallback(data, state) {
    const parts = data.split(':');
    if (data.startsWith('delete:pick:')) {
      const listingId = state.choices?.[Number(parts[2])];
      const listing = listingId && await listingById(listingId);
      if (!listing) return { conversation: null, actions: [sendMessage('That listing no longer exists.', homeKeyboard())] };
      return {
        conversation: { flow: 'delete', step: 'confirm', listingId, title: listing.title },
        actions: [sendMessage(`Delete “${listing.title}”? This cannot be undone.`, keyboard([[
          button('Delete permanently', 'delete:confirm:yes'), button('Keep listing', 'delete:confirm:no')
        ]]))]
      };
    }
    if (data === 'delete:confirm:no') return { conversation: null, actions: [sendMessage('The listing was kept.', homeKeyboard())] };
    if (data === 'delete:confirm:yes') {
      await options.deleteListing(state.listingId);
      return { conversation: null, actions: [sendMessage(`🗑 ${state.title} was deleted.`, homeKeyboard())] };
    }
    return { conversation: state, actions: [sendMessage('Choose a listing with the buttons, or send /cancel.')] };
  }

  async function handleProgressCallback(data, state) {
    const parts = data.split(':');
    if (data.startsWith('progress:pick:')) {
      const listingId = state.choices?.[Number(parts[2])];
      const listing = listingId && await listingById(listingId);
      if (!listing || listing.status !== 'construction') return { conversation: null, actions: [sendMessage('That under-construction listing is no longer available.', homeKeyboard())] };
      return {
        conversation: { flow: 'progress', step: 'stage', listingId, title: listing.title },
        actions: [sendMessage(`Choose the progress stage for ${listing.title}.`, stageKeyboard('progress:stage'))]
      };
    }
    if (data.startsWith('progress:stage:')) {
      if (parts[2] === 'custom') return { conversation: { ...state, step: 'custom_stage' }, actions: [sendMessage('Send the custom stage label.', cancelKeyboard())] };
      return { conversation: { ...state, step: 'photo', stage: parts.slice(2).join(':') }, actions: [sendMessage(`Send the ${parts.slice(2).join(':')} progress photo. Today’s date will be used.`, cancelKeyboard())] };
    }
    return { conversation: state, actions: [sendMessage('Choose a progress option with the buttons, or send /cancel.')] };
  }

  async function handleProgressMessage(message, state) {
    const text = String(message.text || '').trim();
    if (state.step === 'custom_stage') {
      if (!text) throw new Error('Send the stage label as text.');
      return { conversation: { ...state, step: 'photo', stage: text.slice(0, 60) }, actions: [sendMessage(`Send the ${text.slice(0, 60)} progress photo. Today’s date will be used.`, cancelKeyboard())] };
    }
    if (state.step === 'photo') {
      await options.addProgress(state.listingId, {
        stage: state.stage,
        date: new Date().toISOString().slice(0, 10),
        image: await downloadImage(message, 1400)
      });
      return { conversation: null, actions: [sendMessage(`🏗 Progress added to ${state.title}.`, homeKeyboard())] };
    }
    return { conversation: state, actions: [sendMessage('Choose the stage with the buttons, or send /cancel.')] };
  }

  async function handleCallback(data, state) {
    if (data === 'cancel') return { conversation: null, actions: [sendMessage('Conversation cancelled.', homeKeyboard())] };
    if (data.startsWith('command:')) {
      const commands = { new: '/newlisting', edit: '/editlisting', progress: '/addprogress', list: '/mylistings', delete: '/deletelisting' };
      return handleCommand(commands[data.split(':')[1]] || '/help');
    }
    if (!state) return { conversation: null, actions: [sendMessage('That conversation has expired. Start again with /help.', homeKeyboard())] };
    if (data.startsWith('new:')) return handleNewCallback(data, state);
    if (data.startsWith('edit:')) return handleEditCallback(data, state);
    if (data.startsWith('delete:')) return handleDeleteCallback(data, state);
    if (data.startsWith('progress:')) return handleProgressCallback(data, state);
    return { conversation: state, actions: [sendMessage('That button is no longer active. Use /help to start again.', homeKeyboard())] };
  }

  async function processUpdate(update, conversation) {
    const callback = update.callback_query;
    const message = update.message;
    const text = String(message?.text || '').trim();
    const command = text.startsWith('/') ? text.split(/\s+/)[0].toLowerCase().replace(/@[^\s]+$/, '') : '';
    if (command) return handleCommand(command);
    if (callback?.data) return handleCallback(callback.data, conversation);
    if (!conversation) return { conversation: null, actions: [sendMessage('Use /help to see the listing commands.', homeKeyboard())] };
    if (conversation.flow === 'new') return handleNewMessage(message || {}, conversation);
    if (conversation.flow === 'edit') return handleEditMessage(message || {}, conversation);
    if (conversation.flow === 'progress') return handleProgressMessage(message || {}, conversation);
    return { conversation, actions: [sendMessage('Please use the buttons shown, or send /cancel.')] };
  }

  async function handleUpdate(update) {
    const callback = update?.callback_query;
    const message = update?.message;
    const from = callback?.from || message?.from;
    const chat = callback?.message?.chat || message?.chat;
    if (!from || !chat || chat.type !== 'private' || String(from.id) !== ownerId || String(chat.id) !== ownerId) return { ignored: true };

    if (callback?.id) await telegramRequest('answerCallbackQuery', { callback_query_id: callback.id }).catch(error => console.warn(error.message));
    const record = await options.loadState(ownerId);
    const updateId = Number(update.update_id || 0);
    if (updateId && updateId <= Number(record.lastUpdateId || 0)) return { duplicate: true };

    let result;
    try {
      result = await processUpdate(update, record.conversation || null);
    } catch (error) {
      console.error('Telegram bot update failed:', error);
      result = {
        conversation: record.conversation || null,
        actions: [sendMessage(`I couldn’t complete that step: ${error.message || 'Unexpected error'}. Please try again or send /cancel.`)]
      };
    }

    try {
      await options.saveState(ownerId, { conversation: result.conversation || null, lastUpdateId: updateId });
    } catch (error) {
      console.error('Telegram bot state could not be saved:', error);
      await telegramRequest('sendMessage', {
        chat_id: chat.id,
        text: 'The listing database is temporarily unavailable, so I could not safely save this step. Check the website before retrying a publish or delete action, then try again.'
      });
      return { handled: true, storageError: true };
    }
    for (const action of result.actions || []) {
      await telegramRequest(action.method, { chat_id: chat.id, ...action.payload });
    }
    return { handled: true };
  }

  return { handleUpdate };
}

module.exports = {
  MAX_DRAFT_BYTES,
  MAX_IMAGE_BYTES,
  createTelegramBot,
  parsePrice,
  plainTextToHtml,
  stripHtml
};
