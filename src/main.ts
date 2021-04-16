import { createApp } from 'vue'
import electron from 'electron'
import App from './App.vue'
import router from './router'
import store from './store/store'
import axios from 'axios'
import VueAxios from 'vue-axios'
import Dialog from '@/components/dialog/Dialog'
import Menu from '@/components/menu/Menu'
import ImageViewer from '@/components/image-viewer/ImageViewer'
import Scrollbar from '@/components/scrollbar/Scrollbar'
import PostViewer from '@/components/post-viewer/PostViewer'
import Circles from '@/components/circles/Circles'
import Toast from '@/components/toast/Toast'
import { library } from '@fortawesome/fontawesome-svg-core'
import blaze from '@/blaze/blaze'
import i18n from '@/utils/i18n'
import moment from 'moment'
import { faArrowLeft, faArrowRight, faChevronDown, faSearch } from '@fortawesome/free-solid-svg-icons'
import { faPaperPlane } from '@fortawesome/free-regular-svg-icons'
import Markdown from '@/components/markdown'
import Wrapper from '@/components/markdown/wrapper'
import VueIntersect from '@/components/intersect'
import VueTitlebar from '@/components/titlebar/index'
import VideoPlayer from '@/components/video-player'

import 'highlight.js/styles/default.css'
import './assets/index'
// import 'video.js/dist/video-js.css'
import '@/components/video-player/video.scss'

const fontawesome = require('@fortawesome/vue-fontawesome')
library.add(faArrowLeft, faArrowRight, faChevronDown, faSearch, faPaperPlane)

const app = createApp(App)
app.use(VueAxios, axios)
app.use(Dialog)
app.use(Menu)
app.use(Toast)
app.use(ImageViewer)
app.use(Scrollbar)
app.use(PostViewer)
app.use(Circles)
app.use(Markdown)
app.use(Wrapper)
app.use(VueIntersect)
app.use(VueTitlebar)
app.use(VideoPlayer)
app.use(i18n)
app.use(router)
app.use(store)


app.component('font-awesome-icon', fontawesome.FontAwesomeIcon)
app.config.productionTip = false
app.config.devtools = false
// console.log(__VUE_DEVTOOLS_GLOBAL_HOOK__)

app.config.globalProperties.$blaze = blaze
moment.locale(navigator.language)
app.config.globalProperties.$moment = moment
app.config.globalProperties.$electron = electron
let mouseMoveFlag = false
document.onmousedown = () => {
  app.config.globalProperties.$selectNes = null
  mouseMoveFlag = true
  setTimeout(() => {
    if (mouseMoveFlag) {
      app.config.globalProperties.$selectNes = document.getSelection()
    } else {
      app.config.globalProperties.$selectNes = null
    }
  }, 30)
}
document.onmouseup = () => {
  const selectNes = document.getSelection()
  // @ts-ignore
  if (selectNes && selectNes.baseOffset !== selectNes.extentOffset) {
    mouseMoveFlag = true
  } else {
    mouseMoveFlag = false
  }
}

app.mount('#app')
