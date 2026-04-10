import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Quasar, Dark, Notify, Dialog, Loading } from 'quasar'
import router from './router'
import App from './App.vue'

// Quasar styles
import '@quasar/extras/roboto-font/roboto-font.css'
import '@quasar/extras/material-icons/material-icons.css'
import '@quasar/extras/material-icons-outlined/material-icons-outlined.css'
import 'quasar/dist/quasar.css'

// App styles
import './assets/app.scss'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(Quasar, {
  plugins: { Dark, Notify, Dialog, Loading },
  config: {
    dark: true,
    brand: {
      primary: '#10b981',    // Emerald — institutional green (attestto.org)
      secondary: '#0d9488',  // Teal — accent
      accent: '#06b6d4',     // Cyan — highlights
      dark: '#162029',       // Dark slate
      'dark-page': '#0f1923', // Deepest slate
      positive: '#10b981',   // Emerald
      negative: '#ef4444',   // Red
      info: '#3b82f6',       // Blue
      warning: '#f59e0b',    // Amber
    },
  },
})

app.mount('#app')
