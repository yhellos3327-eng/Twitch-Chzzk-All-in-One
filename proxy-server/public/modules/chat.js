import { elements } from './ui.js';

export function loadChatIframe(channel, attempts = 0) {
    if (attempts > 10) {
        console.error('[Chat] Failed to load chat iframe after 10 attempts');
        return;
    }

    let chatIframe = elements.chatIframe();

    if (!chatIframe) {
        const container = elements.chatContainer();
        if (container) {
            chatIframe = document.createElement('iframe');
            chatIframe.id = 'chat-iframe';
            container.appendChild(chatIframe);
        } else {
            setTimeout(() => loadChatIframe(channel, attempts + 1), 500);
            return;
        }
    }

    const hostname = window.location.hostname;
    const chatUrl = `https://www.twitch.tv/embed/${channel}/chat?darkpopout&parent=${hostname}`;

    console.log('[Chat] Loading:', chatUrl);
    chatIframe.src = chatUrl;
}

export function refreshChat(currentChannel) {
    const chatIframe = elements.chatIframe();
    if (chatIframe && currentChannel) {
        console.log('[Chat] Refreshing...');
        const hostname = window.location.hostname;
        const chatUrl = `https://www.twitch.tv/embed/${currentChannel}/chat?darkpopout&parent=${hostname}`;
        chatIframe.src = chatUrl;
    }
}

export function openChatPopup(currentChannel) {
    if (!currentChannel) return;
    const chatUrl = `https://www.twitch.tv/popout/${currentChannel}/chat?darkpopout`;
    window.open(chatUrl, 'twitch-chat', 'width=400,height=600,resizable=yes,scrollbars=yes');
}
