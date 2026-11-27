import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import App from './App'
import { applyTheme } from './lib/theme'
import './styles/globals.css'

document.documentElement.dataset.platform = window.mine.platform

// Paint the live theme before the first frame so nothing flashes.
void window.mine.theme.get().then(({ theme }) => {
  applyTheme(theme)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TooltipProvider delayDuration={400}>
        <App />
      </TooltipProvider>
    </StrictMode>,
  )
})
