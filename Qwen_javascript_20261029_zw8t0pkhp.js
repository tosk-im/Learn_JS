// Конфигурация
const WORKER_URL = 'https://usm-aggregator.ВАШ-ПОДДОМЕН.workers.dev'; // ЗАМЕНИТЕ НА СВОЙ URL

// Состояние приложения
let state = {
    mode: null, // 'tv' или 'media'
    channels: [],
    currentChannel: null
};

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    render();
});

// Рендер приложения
function render() {
    const app = document.getElementById('app');
    
    if (!state.mode) {
        app.innerHTML = renderModeSelection();
    } else if (state.mode === 'tv') {
        app.innerHTML = renderTvScreen();
        loadChannels();
    } else if (state.mode === 'media') {
        app.innerHTML = renderMediaScreen();
    }
    
    attachEventListeners();
}

// Экран выбора режима
function renderModeSelection() {
    return `
        <div class="mode-selection">
            <h1>MyLiveTV</h1>
            <p>Что будем смотреть?</p>
            <div class="mode-cards">
                <div class="mode-card tv" data-action="select-tv">
                    <div class="emoji">📺</div>
                    <h2>ТВ</h2>
                    <p>Живые каналы и EPG</p>
                </div>
                <div class="mode-card media" data-action="select-media">
                    <div class="emoji">🎬</div>
                    <h2>Медиа</h2>
                    <p>Фильмы и сериалы</p>
                </div>
            </div>
        </div>
    `;
}

// ТВ-экран
function renderTvScreen() {
    return `
        <div class="tv-screen">
            <div class="tv-header">
                <h1>📺 ТВ Каналы</h1>
                <button class="back-btn" data-action="back">← Назад</button>
            </div>
            <div id="channels-container" class="channels-grid">
                <div class="loading">Загрузка каналов...</div>
            </div>
        </div>
    `;
}

// Медиа-экран
function renderMediaScreen() {
    return `
        <div class="tv-screen">
            <div class="tv-header">
                <h1>🎬 Фильмы и Сериалы</h1>
                <button class="back-btn" data-action="back">← Назад</button>
            </div>
            <div class="loading">Раздел в разработке</div>
        </div>
    `;
}

// Загрузка каналов с Worker
async function loadChannels() {
    try {
        const response = await fetch(`${WORKER_URL}/search`);
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            state.channels = data.results;
            renderChannels();
        } else {
            document.getElementById('channels-container').innerHTML = 
                '<div class="loading">Каналы не найдены. Проверьте URL Worker.</div>';
        }
    } catch (error) {
        console.error('Ошибка загрузки каналов:', error);
        document.getElementById('channels-container').innerHTML = 
            `<div class="loading">Ошибка: ${error.message}</div>`;
    }
}

// Рендер сетки каналов
function renderChannels() {
    const container = document.getElementById('channels-container');
    
    if (state.channels.length === 0) {
        container.innerHTML = '<div class="loading">Нет каналов</div>';
        return;
    }
    
    container.innerHTML = state.channels.map((channel, index) => `
        <div class="channel-card" data-action="play-channel" data-index="${index}">
            ${channel.logo ? 
                `<img src="${channel.logo}" class="channel-logo" onerror="this.style.display='none'">` : 
                '<div class="channel-logo" style="display:flex;align-items:center;justify-content:center;font-size:32px">📺</div>'
            }
            <div class="channel-name">${channel.title}</div>
        </div>
    `).join('');
}

// Плеер
function playChannel(channel) {
    state.currentChannel = channel;
    
    const overlay = document.createElement('div');
    overlay.className = 'player-overlay';
    overlay.innerHTML = `
        <video controls autoplay>
            <source src="${channel.url}" type="application/x-mpegURL">
            Ваш браузер не поддерживает видео.
        </video>
        <button class="player-close" data-action="close-player">✕ Закрыть</button>
    `;
    
    document.body.appendChild(overlay);
    
    // Обработчик закрытия
    overlay.querySelector('[data-action="close-player"]').addEventListener('click', () => {
        overlay.remove();
        state.currentChannel = null;
    });
}

// Обработчики событий
function attachEventListeners() {
    document.querySelectorAll('[data-action]').forEach(el => {
        el.addEventListener('click', (e) => {
            const action = el.getAttribute('data-action');
            
            if (action === 'select-tv') {
                state.mode = 'tv';
                render();
            } else if (action === 'select-media') {
                state.mode = 'media';
                render();
            } else if (action === 'back') {
                state.mode = null;
                render();
            } else if (action === 'play-channel') {
                const index = parseInt(el.getAttribute('data-index'));
                playChannel(state.channels[index]);
            }
        });
    });
}