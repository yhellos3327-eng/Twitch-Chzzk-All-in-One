export async function getStreamInfo(channel) {
    const proxyUrl = window.location.origin;
    const response = await fetch(`${proxyUrl}/stream/${channel}`);
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    return await response.json();
}
