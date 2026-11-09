import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PopupApp, WidgetApp } from './components/Widget'
import { Capacitor } from '@capacitor/core'

// 안드로이드 앱: 제스처 바가 화면 아래를 덮는데 기기에 따라 안전 영역이 0 으로 오므로 최소 여백을 보장한다
if (Capacitor.getPlatform() === 'android') document.documentElement.classList.add('android')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('popup') ? <PopupApp /> : new URLSearchParams(location.search).has('widget') ? <WidgetApp /> : <App />}
  </StrictMode>,
)
