import api from '@/api/base'

export default {
  getUserById(id: string) {
    return api.get('/users/' + id)
  },
  getUsers(body: any) {
    return api.post('/users/fetch', body)
  },
  getSessions(body: any) {
    return api.post('/sessions/fetch', body)
  },
  updateSession(body: any) {
    return api.post('/session', body)
  },
  updateRelationship(body: any) {
    return api.post('/relationships', body)
  }
}
