import React, { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, CrosshairMode } from 'lightweight-charts';

export default function ChartPanel({ candles, timeframe, sessionId, drawings, drawingMode, onNewLine, resetSignal, fitSignal }) {
  const rootRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const drawingModeRef = useRef(drawingMode);
  const onNewLineRef = useRef(onNewLine);
  const chartLinesRef = useRef([]);
  const tfRef = useRef(timeframe);
  const sidRef = useRef(sessionId);
  drawingModeRef.current = drawingMode;
  onNewLineRef.current = onNewLine;
  tfRef.current = timeframe;
  sidRef.current = sessionId;

  useEffect(() => {
    if (!rootRef.current) return;
    const chart = createChart(rootRef.current, {
      autoSize: true,
      layout: { background: { color: '#101b2e' }, textColor: '#AFC0D5' },
      grid: { vertLines: { color: '#233047' }, horzLines: { color: '#233047' } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: '#33465e', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#33465e', autoScale: true },
      handleScroll: true, handleScale: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#42B891', downColor: '#E17978',
      wickUpColor: '#42B891', wickDownColor: '#E17978',
      borderVisible: false, priceLineVisible: true,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    chartRef.current=chart;
    candleSeriesRef.current=series;
    volumeSeriesRef.current=volume;
    const onClick=(param) => {
      if (!drawingModeRef.current || !param.point) return;
      const price=series.coordinateToPrice(param.point.y);
      if (price != null && Number.isFinite(price) && price>0) onNewLineRef.current?.(price);
    };
    chart.subscribeClick(onClick);
    return () => {
      chart.unsubscribeClick(onClick);
      chart.remove();
      chartRef.current=null;
      candleSeriesRef.current=null;
      volumeSeriesRef.current=null;
    };
  }, []);

  useEffect(() => {
    const chart=chartRef.current;
    const series=candleSeriesRef.current;
    const vol=volumeSeriesRef.current;
    if (!chart || !series || !vol) return;
    const ohlc=candles.map(c=>({
      time:c.time/1000,open:c.open,high:c.high,low:c.low,close:c.close,
    }));
    series.setData(ohlc);
    vol.setData(candles.map(c=>({
      time:c.time/1000, value:c.volume,
      color:c.close>=c.open?'#286c61':'#784448'
    })));
    // A viewport is saved per session+timeframe, so switching timeframe restores its last view.
    const key=`crl-viewport:${sessionId}:${timeframe}`;
    let saved=null;
    try { saved=JSON.parse(localStorage.getItem(key)||'null'); } catch { /* ignore invalid values */ }
    if (saved && Number.isFinite(saved.from) && Number.isFinite(saved.to)) {
      chart.timeScale().setVisibleLogicalRange(saved);
    } else {
      chart.timeScale().fitContent();
    }
  }, [candles,timeframe,sessionId]);

  useEffect(() => {
    const chart=chartRef.current;
    if (!chart || !sessionId) return;
    const handler = (range) => {
      if (range && Number.isFinite(range.from) && Number.isFinite(range.to)) {
        localStorage.setItem(`crl-viewport:${sidRef.current}:${tfRef.current}`,JSON.stringify(range));
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [sessionId]);

  useEffect(() => {
    const series=candleSeriesRef.current;
    if (!series) return;
    for (const pl of chartLinesRef.current) series.removePriceLine(pl);
    chartLinesRef.current=(drawings||[]).map(d=>series.createPriceLine({
      price:d.price, color:'#F0C266',lineWidth:2,lineStyle:2,
      axisLabelVisible:true,title:'User S/R'
    }));
  }, [drawings]);

  useEffect(() => {
    if (fitSignal>0) chartRef.current?.timeScale().fitContent();
  }, [fitSignal]);

  useEffect(() => {
    if (resetSignal<=0 || !chartRef.current) return;
    localStorage.removeItem(`crl-viewport:${sessionId}:${timeframe}`);
    chartRef.current.priceScale('right').applyOptions({autoScale:true});
    chartRef.current.timeScale().fitContent();
  }, [resetSignal]);

  return <div ref={rootRef} className="chart-area" aria-label="Interactive replay candlestick chart" />;
}
