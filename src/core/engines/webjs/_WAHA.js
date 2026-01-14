exports.LoadWAHA = () => {
  window.WAHA = {};

  // Patch sendSeen to avoid crash if WAWebStreamModel is missing
  // https://github.com/pedroslopez/whatsapp-web.js/issues/2613
  window.WWebJS.sendSeen = async (chatId) => {
    const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
    if (chat) {
      if (window.Store.WAWebStreamModel && window.Store.WAWebStreamModel.Stream) {
        window.Store.WAWebStreamModel.Stream.markAvailable();
      }
      if (window.Store.SendSeen) {
        await window.Store.SendSeen.sendSeen(chat);
      }
      if (window.Store.WAWebStreamModel && window.Store.WAWebStreamModel.Stream) {
        window.Store.WAWebStreamModel.Stream.markUnavailable();
      }
      return true;
    }
    return false;
  };

  window.WAHA.WAWebBizLabelEditingAction = window.require(
    'WAWebBizLabelEditingAction',
  );

  window.WAHA.getChats = async (pagination, filter) => {
    let chats = window.Store.Chat.getModelsArray().slice();

    // Filter chats by IDs if filter is provided
    if (filter && filter.ids && filter.ids.length > 0) {
      chats = chats.filter((chat) => filter.ids.includes(chat.id._serialized));
    }

    const paginator = new window.Paginator(pagination);
    chats = paginator.apply(chats);
    const chatPromises = chats.map((chat) => window.WWebJS.getChatModel(chat));
    return await Promise.all(chatPromises);
  };

  // Set push name
  window.WAHA.WAWebSetPushnameConnAction = window.require(
    'WAWebSetPushnameConnAction',
  );

  // Get my status
  window.WAHA.WAWebTextStatusCollection = window.require(
    'WAWebTextStatusCollection',
  );
};
