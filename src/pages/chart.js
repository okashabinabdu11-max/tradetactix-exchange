// Live XAUUSD chart from TradingView's free embeddable widget.
// The chart and its prices are drawn by TradingView inside its own frame;
// this app does not read those prices.

const WIDGET_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
export const CHART_SYMBOL = 'OANDA:XAUUSD';

// One view per step of the plan. 4H is a line chart because that is how the
// levels are drawn; the others are candles.
export const CHART_VIEWS = [
  { id: '4h', label: '4H', job: 'Support and resistance', interval: '240', style: '2' },
  { id: '1h', label: '1H', job: 'Liquidity highs and lows', interval: '60', style: '1' },
  { id: '15m', label: '15M', job: 'Retest and entry', interval: '15', style: '1' },
  { id: '5m', label: '5M', job: 'Extra confirmation', interval: '5', style: '1' },
];

export function widgetConfig(view) {
  return {
    autosize: true,
    symbol: CHART_SYMBOL,
    interval: view.interval,
    style: view.style,
    timezone: 'Etc/UTC',
    theme: 'dark',
    locale: 'en',
    backgroundColor: 'rgba(15, 23, 34, 1)',
    allow_symbol_change: false,
    hide_side_toolbar: false,
    withdateranges: true,
    save_image: false,
    calendar: false,
    support_host: 'https://www.tradingview.com',
  };
}

let currentView = '4h'; // remembered while the app stays open

function loadWidget(host, view) {
  host.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = WIDGET_SRC;
  script.async = true;
  script.textContent = JSON.stringify(widgetConfig(view));
  script.addEventListener('error', () => {
    host.innerHTML = '<p class="result-errors chart-error">The TradingView chart could not load. Check your connection, or whether a content blocker is stopping tradingview.com.</p>';
  });
  host.appendChild(script);
}

export function chartPage() {
  const tabs = CHART_VIEWS.map((v) => `
    <button class="tf-tab" type="button" role="tab" data-view="${v.id}" aria-selected="${v.id === currentView}">
      <strong>${v.label}</strong><span>${v.job}</span>
    </button>`).join('');

  return {
    title: 'Chart',
    html: `
      <header class="page-head">
        <h1>Chart</h1>
        <p>Live XAUUSD from TradingView. Switch between the four timeframes of your plan.</p>
      </header>
      <div class="tf-tabs" role="tablist" aria-label="Timeframe">${tabs}</div>
      <div class="chart-frame"><div class="tradingview-widget-container" id="tv-chart"></div></div>
      <p class="panel-note">Prices on this chart come from OANDA through TradingView, so they can differ slightly from your Exness quotes. Times are in UTC. Levels you draw here are not saved, and the app does not read this chart: the signal engine needs its own price feed.</p>`,
    mount(root) {
      const host = root.querySelector('#tv-chart');
      const show = (id) => {
        currentView = id;
        root.querySelectorAll('.tf-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === id)));
        loadWidget(host, CHART_VIEWS.find((v) => v.id === id));
      };
      const onClick = (e) => {
        const tab = e.target.closest('.tf-tab');
        if (tab && tab.dataset.view !== currentView) show(tab.dataset.view);
      };
      root.addEventListener('click', onClick);
      show(currentView);
      return () => { root.removeEventListener('click', onClick); host.innerHTML = ''; };
    },
  };
}
