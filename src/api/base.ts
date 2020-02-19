import axios from 'axios'
import Url from 'url-parse'
// @ts-ignore
import jwt from 'jsonwebtoken'
import { getToken } from '@/utils/util'
import { clearDb } from '@/persistence/db_util'
import { API_URL } from '@/utils/constants'
import store from '@/store/store'
// @ts-ignore
import router from '@/router'
// @ts-ignore
import Vue from 'vue'

axios.defaults.headers.post['Content-Type'] = 'application/json'

const axiosApi = axios.create({
  baseURL: API_URL.HTTP[0],
  timeout: 8000
})

function newToken(config: any) {
  const url = new Url(config.url)
  const token = getToken(config.method.toUpperCase(), url.pathname, config.data)
  return 'Bearer ' + token
}

const backOff = new Promise(resolve => {
  setTimeout(() => {
    resolve()
  }, 1500)
})

async function retry(config: any, response: any) {
  if (!config || !config.retry) {
    return Promise.reject(response)
  }
  config.__retryCount = config.__retryCount || 0
  if (config.__retryCount >= config.retry) {
    return Promise.reject(response)
  }
  config.__retryCount += 1
  await backOff
  config.baseURL = API_URL.HTTP[config.__retryCount % API_URL.HTTP.length]
  const token = newToken(config)
  if (token) {
    config.headers.Authorization = token
  }
  return axiosApi(config)
}

axiosApi.interceptors.request.use(
  (config: any) => {
    const url = new Url(config.url)
    config.retry = 2 ** 31
    const token = getToken(config.method.toUpperCase(), url.pathname, config.data)
    config.headers.common['Authorization'] = token
    config.headers.common['Accept-Language'] = navigator.language
    return config
  },
  (error: any) => {
    return Promise.reject(error)
  }
)

axiosApi.interceptors.response.use(
  function(response: any) {
    if (response.data.error && response.data.error.code === 500) {
      const config: any = response.config
      return retry(config, response)
    }
    // @ts-ignore
    const timeLag = Math.abs(response.headers['x-server-time'] / 1000000 - Date.parse(new Date()))
    if (timeLag > 600000) {
      store.dispatch('showTime')
      return Promise.reject(response)
    } else {
      store.dispatch('hideTime')
    }

    if (response.data.error && response.data.error.code === 401) {
      const tokenStr = response.config.headers.Authorization
      if (tokenStr) {
        const tokenJson = jwt.decode(tokenStr.split(' ')[1])
        if (tokenJson && tokenJson.iat * 1000 < new Date().getTime() - 60000) {
          Vue.prototype.$blaze.closeBlaze()
          clearDb()
          router.push('/sign_in')
          return Promise.reject(response)
        } else {
          return retry(response.config, response)
        }
      }
    }
    return response
  },
  function(error: any) {
    const config = error.config
    return retry(config, error)
  }
)

export default axiosApi
