// Loads one of TradingView's free embeddable widgets into `host`.
// Each widget draws itself inside its own frame; the app does not read its data.

const BASE = 'https://s3.tradingview.com/external-embedding/';

export function loadTradingViewWidget(host, scriptName, config, failText) {
  host.classList.add('tradingview-widget-container');
  host.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = `${BASE}${scriptName}`;
  script.async = true;
  script.textContent = JSON.stringify(config);
  script.addEventListener('error', () => {
    host.innerHTML = `<p class="result-errors widget-error">${failText} Check your connection, or whether a content blocker is stopping tradingview.com.</p>`;
  });
  host.appendChild(script);
}
