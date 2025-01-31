import conversationDao from '@/dao/conversation_dao'
import messageDao from '@/dao/message_dao'
import stickerDao from '@/dao/sticker_dao'
import userDao from '@/dao/user_dao'
import participantDao from '@/dao/participant_dao'
import messageMentionDao from '@/dao/message_mention_dao'
import circleConversationDao from '@/dao/circle_conversation_dao'
import conversationApi from '@/api/conversation'
import circleDao from '@/dao/circle_dao'
import circleApi from '@/api/circle'
import userApi from '@/api/user'
import { delMedia, delMediaMessages, generateConversationId, getAccount } from '@/utils/util'
import { ConversationStatus, ConversationCategory, MessageStatus, MediaStatus, messageType } from '@/utils/constants'
import { ipcRenderer } from 'electron'

// @ts-ignore
import { v4 as uuidv4 } from 'uuid'
// @ts-ignore
import _ from 'lodash'
import jobDao from '@/dao/job_dao'
import {
  downloadAttachment,
  downloadQueue,
  uploadAttachment,
  putAttachment,
  AttachmentMessagePayload
} from '@/utils/attachment_util'
import appDao from '@/dao/app_dao'

function markRead(commit: any, state: any, conversationId: any) {
  ipcRenderer.send('taskRequest', { action: 'markRead', conversationId })
}

async function refreshConversation(conversationId: any, callback: () => void) {
  const c = await conversationApi.getConversation(conversationId)
  if (c.data.data) {
    const conversation = c.data.data
    const me: any = getAccount()
    const result = conversation.participants.some(function(item: any) {
      return item.user_id === me.user_id
    })

    const status = result ? ConversationStatus.SUCCESS : ConversationStatus.QUIT
    let ownerId = conversation.creator_id
    if (conversation.category === ConversationCategory.CONTACT) {
      conversation.participants.forEach(function(item: any) {
        if (item.user_id !== me.user_id) {
          ownerId = item.user_id
        }
      })
    }
    conversationDao.updateConversation({
      conversation_id: conversation.conversation_id,
      owner_id: ownerId,
      category: conversation.category,
      name: conversation.name,
      announcement: conversation.announcement,
      created_at: conversation.created_at,
      status: status,
      mute_until: conversation.mute_until
    })
    await refreshParticipants(conversation.conversation_id, conversation.participants, callback)
    await syncUser(ownerId)
    await refreshCircle(conversation)
  }
}
async function refreshParticipants(conversationId: any, participants: any[], callback: () => void) {
  const local = participantDao.getParticipants(conversationId)
  const localIds = local.map(function(item: any) {
    return item.user_id
  })
  const online: any = []
  participants.forEach(function(item: any, index: number) {
    online[index] = {
      conversation_id: conversationId,
      user_id: item.user_id,
      role: item.role,
      created_at: item.created_at
    }
  })

  const add = online.filter(function(item: any) {
    return !localIds.some(function(e: any) {
      return item.user_id === e
    })
  })
  const remove = localIds.filter(function(item: any) {
    return !online.some(function(e: any) {
      return item === e.user_id
    })
  })
  if (add.length > 0) {
    participantDao.insertAll(add)
    const needFetchUsers = add.map(function(item: any) {
      return item.user_id
    })
    fetchUsers(needFetchUsers)
  }
  if (remove.length > 0) {
    participantDao.deleteAll(conversationId, remove)
  }

  if (add.length > 0 || remove.length > 0) {
    callback()
  }
}

async function syncUser(userId: string) {
  let user = userDao.findUserById(userId)
  if (!user) {
    const response = await userApi.getUserById(userId)
    if (response.data.data) {
      user = response.data.data
      userDao.insertUser(user)
      appDao.insert(user.app)
    }
  }
  return user
}

async function refreshCircle(conversation: any) {
  if (!conversation.circles) return
  const list: any = []
  conversation.circles.forEach((circle: any) => {
    const ret = circleDao.findCircleById(circle.circle_id)
    if (!ret) {
      circleApi.getCircleById(circle.circle_id).then((res: any) => {
        if (res.data && res.data.data) {
          const temp = res.data.data
          circleDao.insertUpdate(temp)
        }
      })
    }
    list.push(circle)
  })
  circleConversationDao.insertUpdate(list)
}

async function fetchUsers(users: any[]) {
  const resp = await userApi.getUsers(users)
  if (resp.data.data) {
    userDao.insertUsers(resp.data.data)
  }
}

export default {
  createUserConversation: ({ commit, state }: any, payload: { user: any }) => {
    const { user } = payload
    const account: any = getAccount()
    if (user.user_id === account.user_id) {
      return
    }
    let conversation = conversationDao.getConversationByUserId(user.user_id)
    if (conversation && state.conversations && state.conversations[conversation.conversation_id]) {
      commit('setCurrentConversation', conversation)
    } else {
      const senderId = account.user_id
      const conversationId = generateConversationId(senderId, user.user_id)
      const createdAt = new Date().toISOString()
      conversation = {
        conversation_id: conversationId,
        owner_id: user.user_id,
        category: ConversationCategory.CONTACT,
        name: null,
        icon_url: null,
        announcement: '',
        code_url: null,
        pay_type: null,
        created_at: createdAt,
        pin_time: null,
        last_message_id: null,
        last_read_message_id: null,
        unseen_message_count: 0,
        status: ConversationStatus.START,
        draft: null,
        draftText: null,
        mute_until: null
      }
      conversationDao.insertConversation(conversation)
      participantDao.insertAll([
        {
          conversation_id: conversationId,
          user_id: senderId,
          role: '',
          created_at: new Date().toISOString()
        },
        {
          conversation_id: conversationId,
          user_id: user.user_id,
          role: '',
          created_at: new Date().toISOString()
        }
      ])
      commit('setCurrentConversation', conversation)
    }
  },
  createGroupConversation: async({ commit }: any, payload: { groupName: any; users: any }) => {
    const response = await conversationApi.createGroupConversation(payload.groupName, payload.users)
    if (response.data.data) {
      const conversation = response.data.data
      conversationDao.insertConversation({
        conversation_id: conversation.conversation_id,
        owner_id: conversation.creator_id,
        category: conversation.category,
        name: conversation.name,
        icon_url: conversation.icon_url,
        announcement: conversation.announcement,
        code_url: conversation.code_url,
        pay_type: null,
        created_at: conversation.created_at,
        pin_time: null,
        last_message_id: null,
        last_read_message_id: null,
        unseen_message_count: 0,
        status: ConversationStatus.SUCCESS,
        draft: null,
        draftText: null,
        mute_until: conversation.mute_until
      })
      if (conversation.participants) {
        participantDao.insertAll(
          conversation.participants.map((item: any) => {
            return {
              conversation_id: conversation.conversation_id,
              user_id: item.user_id,
              role: item.role,
              created_at: item.created_at
            }
          })
        )
        commit('refreshParticipants', conversation.conversation_id)
      }
      commit('setCurrentConversation', conversation)
    }
  },
  addParticipants: async({ commit }: any, payload: { participants: any; conversationId: string }) => {
    const { participants, conversationId } = payload
    participants.forEach((item: any) => {
      conversationApi.participant(conversationId, 'ADD', item.user_id, '').then(res => {
        const retData = res.data.data
        if (retData) {
          const userIds = retData.participants.map((p: any) => {
            return p.user_id
          })
          if (userIds.indexOf(item.user_id) > -1) {
            participantDao.insert({
              conversation_id: conversationId,
              user_id: item.user_id,
              role: '',
              created_at: item.created_at
            })
          }
        }
      })
    })
  },
  saveAccount: ({ commit }: any, user: any) => {
    userDao.insertUser(user)
    commit('saveAccount', user)
  },
  setSearching: async({ commit }: any, keyword: any) => {
    commit('setSearching', keyword)
  },
  setCurrentUser: async({ commit }: any, user: any) => {
    commit('setCurrentUser', user)
  },
  setCurrentConversation: async({ commit }: any, conversation: any) => {
    commit('setCurrentConversation', conversation)
  },
  markRead: ({ commit, state }: any, conversationId: any) => {
    markRead(commit, state, conversationId)
    setTimeout(() => {
      commit('refreshConversation', conversationId)
    }, 100)
  },
  markMentionRead: ({ commit }: any, { conversationId, messageId }: any) => {
    messageMentionDao.markMentionRead(messageId)
    const blazeMessage = { message_id: messageId, status: 'MENTION_READ' }
    jobDao.insert({
      job_id: uuidv4(),
      action: 'CREATE_MESSAGE',
      created_at: new Date().toISOString(),
      order_id: null,
      priority: 5,
      user_id: null,
      blaze_message: JSON.stringify(blazeMessage),
      conversation_id: conversationId,
      resend_message_id: null,
      run_count: 0
    })
    commit('markMentionRead', { conversationId, messageId })
  },
  updateConversationMute: ({ commit }: any, { conversation, ownerId }: any) => {
    if (conversation.category === ConversationCategory.CONTACT) {
      userDao.updateMute(conversation.mute_until, ownerId)
    } else if (conversation.category === ConversationCategory.GROUP) {
      conversationDao.updateMute(conversation.mute_until, conversation.conversation_id)
    }
    commit('refreshConversations')
  },
  setUnseenBadgeNum({ commit }: any) {
    setTimeout(() => {
      commit('setUnseenBadgeNum')
    }, 100)
  },
  setTempUnreadMessageId({ commit }: any, messageId: string) {
    commit('setTempUnreadMessageId', messageId)
  },
  conversationClear: ({ commit }: any, conversationId: any) => {
    const messages = messageDao.findConversationMediaMessages(conversationId)
    delMediaMessages(messages)
    ipcRenderer.send('taskRequest', { action: 'conversationClear', conversationId })
    commit('conversationClear', conversationId)
    commit('setUnseenBadgeNum')
  },
  syncUser(_: any, userId: any) {
    return syncUser(userId)
  },
  pinTop: ({ commit, state }: any, payload: { conversationId: any; circlePinTime: any; pinTime: any }) => {
    const { conversationId, circlePinTime, pinTime } = payload
    if (circlePinTime !== undefined) {
      const newPinTime = circlePinTime ? '' : new Date().toISOString()
      const circle = state.currentCircle
      circleConversationDao.updateConversationPinTimeById(conversationId, circle.circle_id, newPinTime)
      commit('setCurrentCircle', circle)
    } else {
      conversationDao.updateConversationPinTimeById(conversationId, pinTime ? null : new Date().toISOString())
      commit('refreshConversations')
    }
  },
  refreshUser: async({ commit }: any, { userId, conversationId }: any) => {
    const response = await userApi.getUserById(userId)
    let u = response.data && response.data.data
    if (u) {
      let user = userDao.findUserById(userId)
      if (u) {
        userDao.insertUser(u)
      }
      if (user) {
        if (!u.mute_until) {
          u.mute_until = user.mute_until
        }
        userDao.update(u)
      }
      appDao.insert(u.app)
      if (conversationId) {
        commit('refreshConversation', conversationId)
      }
    }
  },
  setCurrentVideo: ({ commit }: any, videoMessage: any) => {
    commit('setCurrentVideo', videoMessage)
  },
  setCurrentAudio: ({ commit }: any, audioMessage: any) => {
    commit('setCurrentAudio', audioMessage)
  },
  setCurrentMessages: ({ commit }: any, messages: any) => {
    commit('setCurrentMessages', messages)
  },
  sendMessage: ({ commit, state }: any, { msg, quoteId }: any) => {
    const { conversationId } = msg
    // markRead(commit, state, conversationId)

    let messageId = ''
    if (quoteId) {
      let quoteItem = messageDao.findMessageItemById(conversationId, quoteId)
      if (quoteItem) {
        messageId = messageDao.insertRelyMessage(msg, quoteId, JSON.stringify(quoteItem))
        jobDao.insertSendingJob(messageId, conversationId)
        commit('refreshMessage', { conversationId, messageIds: [messageId] })
        return
      }
    }
    if (!messageId) {
      if (messageType(msg.category) === 'contact') {
        messageId = messageDao.insertContactMessage(msg)
      } else {
        messageId = messageDao.insertTextMessage(msg)
      }
    }
    jobDao.insertSendingJob(messageId, conversationId)
    commit('refreshMessage', { conversationId, messageIds: [messageId] })
  },
  sendStickerMessage: (
    { commit, state }: any,
    msg: { conversationId: any; stickerId?: any; category?: any; status?: any }
  ) => {
    const { conversationId, stickerId, category, status } = msg
    markRead(commit, state, conversationId)
    const messageId = uuidv4().toLowerCase()
    const content = btoa(`{"sticker_id":"${stickerId}"}`)
    const account: any = getAccount()
    messageDao.insertMessage({
      message_id: messageId,
      conversation_id: conversationId,
      user_id: account.user_id,
      category,
      content,
      status,
      created_at: new Date().toISOString(),
      sticker_id: stickerId
    })
    const sticker = stickerDao.getStickerByUnique(stickerId)
    sticker.last_use_at = new Date().toISOString()
    stickerDao.insertUpdate(sticker)
    jobDao.insertSendingJob(messageId, conversationId)
    commit('refreshMessage', { conversationId, messageIds: [messageId] })
  },
  sendLiveMessage: ({ commit }: any, msg: { conversationId: any; payload: AttachmentMessagePayload }) => {
    const { conversationId, payload } = msg
    const { mediaUrl, mediaMimeType, mediaSize, mediaWidth, mediaHeight, thumbUrl, mediaName, category } = payload
    const messageId = uuidv4().toLowerCase()
    const data = {
      width: mediaWidth,
      height: mediaHeight,
      thumb_url: thumbUrl,
      url: mediaUrl
    }
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(data))))
    const account: any = getAccount()
    messageDao.insertMessage({
      message_id: messageId,
      conversation_id: conversationId,
      user_id: account.user_id,
      content: content,
      category: category,
      media_url: mediaUrl,
      media_mime_type: mediaMimeType,
      media_size: mediaSize,
      media_width: mediaWidth,
      media_height: mediaHeight,
      thumb_url: thumbUrl,
      media_status: 'PENDING',
      status: MessageStatus.SENDING,
      created_at: new Date().toISOString(),
      name: mediaName
    })
    jobDao.insertSendingJob(messageId, conversationId)
    commit('refreshMessage', { conversationId, messageIds: [messageId] })
  },
  sendAttachmentMessage: ({ commit }: any, { conversationId, payload, quoteId }: any) => {
    const messageId = uuidv4().toLowerCase()
    payload.id = messageId
    payload.conversationId = conversationId
    const account: any = getAccount()
    putAttachment(
      payload,
      (data: AttachmentMessagePayload) => {
        const msg: any = {
          message_id: messageId,
          conversation_id: conversationId,
          user_id: account.user_id,
          category: data.category,
          media_url: data.mediaUrl,
          media_mime_type: data.mediaMimeType,
          media_size: data.mediaSize,
          media_width: data.mediaWidth,
          media_height: data.mediaHeight,
          media_waveform: data.mediaWaveform,
          media_duration: data.mediaDuration,
          thumb_image: data.thumbImage,
          media_status: 'PENDING',
          status: MessageStatus.SENDING,
          created_at: new Date().toISOString(),
          name: data.mediaName
        }
        if (quoteId) {
          let quoteItem = messageDao.findMessageItemById(conversationId, quoteId)
          if (quoteItem) {
            msg.quote_message_id = quoteId
            msg.quote_content = JSON.stringify(quoteItem)
          }
        }
        messageDao.insertMessage(msg)
        commit('startLoading', messageId)
        commit('refreshMessage', { conversationId, messageIds: [messageId] })
      },
      (transferAttachmentData: any) => {
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(transferAttachmentData))))
        messageDao.updateMessageContent(content, messageId)
        messageDao.updateMediaStatus(MediaStatus.DONE, messageId)
        messageDao.updateMessageStatusById(MessageStatus.SENDING, messageId)
        jobDao.insertSendingJob(messageId, conversationId)
        commit('stopLoading', messageId)
        commit('refreshMessage', { conversationId, messageIds: [messageId] })
      },
      (e: any) => {
        messageDao.updateMediaStatus(MediaStatus.CANCELED, messageId)
        commit('stopLoading', messageId)
        commit('refreshMessage', { conversationId, messageIds: [messageId] })
      }
    )
  },
  upload: (
    { commit }: any,
    message: {
      messageId: any
      type: any
      conversationId: any
      payload: AttachmentMessagePayload
    }
  ) => {
    const { messageId, type, conversationId, payload } = message
    commit('startLoading', message.messageId)

    const { mediaUrl, mediaMimeType, mediaSize, mediaWidth, mediaHeight, mediaName, thumbImage } = payload

    if (!mediaUrl) return
    uploadAttachment(
      messageId,
      mediaUrl.replace('file://', ''),
      type,
      (attachmentId: any, key: any, digest: any) => {
        let msg = {
          attachment_id: attachmentId,
          mime_type: mediaMimeType,
          size: mediaSize,
          width: mediaWidth,
          height: mediaHeight,
          name: mediaName,
          // media_waveform: '',
          thumbnail: thumbImage,
          digest: digest,
          key: key
        }
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(msg))))
        messageDao.updateMessageContent(content, messageId)
        messageDao.updateMediaStatus(MediaStatus.DONE, messageId)
        messageDao.updateMessageStatusById(MessageStatus.SENDING, messageId)
        jobDao.insertSendingJob(messageId, conversationId)
        commit('stopLoading', messageId)
        commit('refreshMessage', { conversationId, messageIds: [messageId] })
      },
      (e: any) => {
        messageDao.updateMediaStatus(MediaStatus.CANCELED, messageId)
        commit('stopLoading', messageId)
        commit('refreshMessage', { conversationId, messageIds: [messageId] })
      }
    )
  },
  init: ({ commit }: any) => {
    commit('init')
  },
  refreshFriends: async({ commit }: any, friends: any[]) => {
    userDao.insertUsers(friends)
    let f = friends.map((item: any) => item.user_id)
    let df = userDao
      .findFriends()
      .filter((item: any) => {
        return !f.some((id: any) => {
          return item.user_id === id
        })
      })
      .map((item: any) => {
        return item.user_id
      })
    if (df.length > 0) {
      const resp = await userApi.getUsers(df)
      if (resp.data.data) {
        userDao.insertUsers(resp.data.data)
      }
    }
    commit('refreshFriends', friends)
  },
  setCurrentCircle: ({ commit }: any, circle: any) => {
    commit('setCurrentCircle', circle)
  },
  insertUser: (_: any, user: any) => {
    userDao.insertUser(user)
  },
  makeMessageStatus: ({ commit }: any, payload: { status: any; messageId: any }) => {
    messageDao.updateMessageStatusById(payload.status, payload.messageId)
    const conversationId = messageDao.getConversationIdById(payload.messageId)
    commit('refreshMessage', { conversationId, messageIds: [payload.messageId] })
  },
  search: ({ commit }: any, payload: any) => {
    commit('search', payload)
  },
  searchClear: ({ commit }: any) => {
    commit('searchClear')
  },
  refreshParticipants: ({ commit }: any, conversationId: any) => {
    commit('refreshParticipants', conversationId)
  },
  refreshMessage: ({ commit }: any, payload: any) => {
    commit('refreshMessage', payload)
  },
  exit: ({ commit }: any) => {
    commit('exit')
  },
  showTime: ({ commit }: any) => {
    commit('toggleTime', true)
  },
  hideTime: ({ commit }: any) => {
    commit('toggleTime', false)
  },
  setLinkStatus: ({ commit }: any, status: any) => {
    commit('setLinkStatus', status)
  },
  unblock: ({ commit }: any, userId: any) => {
    userApi.updateRelationship({ user_id: userId, action: 'UNBLOCK' }).then((res: any) => {
      if (res.data && res.data.data) {
        commit('setCurrentUser', res.data.data)
      }
    })
  },
  report: ({ commit }: any, userId: any) => {
    userApi
      .report({
        user_id: userId,
        action: 'BLOCK'
      })
      .then(res => {
        if (res.data && res.data.data) {
          commit('setCurrentUser', res.data.data)
        }
      })
  },
  exitGroup: ({ commit }: any, conversationId: any) => {
    conversationApi.exit(conversationId)
  },
  participantSetAsAdmin: (_: any, payload: { conversationId: any; userId: any }) => {
    const { conversationId, userId } = payload
    conversationApi.participant(conversationId, 'ROLE', userId, 'ADMIN')
  },
  participantDismissAdmin: (_: any, payload: { conversationId: any; userId: any }) => {
    const { conversationId, userId } = payload
    conversationApi.participant(conversationId, 'ROLE', userId, 'USER')
  },
  participantRemove: (_: any, payload: { conversationId: any; userId: any }) => {
    const { conversationId, userId } = payload
    conversationApi.participant(conversationId, 'REMOVE', userId, '')
  },
  startLoading: ({ commit }: any, messageId: any) => {
    commit('startLoading', messageId)
  },
  stopLoading: ({ commit }: any, messageId: any) => {
    commit('stopLoading', messageId)
  },
  updateFetchPercent: ({ commit }: any, payload: any) => {
    commit('updateFetchPercent', payload)
  },
  download: ({ commit }: any, messageId: any) => {
    commit('startLoading', messageId)
    let message = messageDao.getMessageById(messageId)
    downloadQueue.push(
      async(message: any) => {
        try {
          const filePath: any = await downloadAttachment(message)
          if (filePath) {
            const updateRet = messageDao.updateMediaMessage('file://' + filePath, MediaStatus.DONE, message.message_id)
            if (updateRet.changes !== 1) {
              console.log('downloadAttachment retry:', message.message_id, message.message_id)
              messageDao.updateMediaMessage('file://' + filePath, MediaStatus.DONE, message.message_id)
            }
          }
          commit('stopLoading', message.message_id)
          commit('refreshMessage', { conversationId: message.conversation_id, messageIds: [message.message_id] })
        } catch (e) {
          messageDao.updateMediaMessage(null, MediaStatus.CANCELED, message.message_id)
          commit('stopLoading', message.message_id)
          commit('refreshMessage', { conversationId: message.conversation_id, messageIds: [message.message_id] })
        }
      },
      { args: message }
    )
    commit('refreshMessage', { conversationId: message.conversation_id, messageIds: [message.message_id] })
  },
  syncConversation: ({ commit }: any, conversationId: any) => {
    refreshConversation(conversationId, function() {
      commit('refreshConversation', conversationId)
    })
  },
  recallMessage: ({ commit }: any, { messageId, conversationId }: any) => {
    const message = messageDao.getMessageById(messageId)
    delMedia([message])
    messageDao.recallMessageAndSend(messageId)
    let quoteItem = messageDao.findMessageItemById(conversationId, messageId)
    if (quoteItem) {
      messageDao.updateQuoteContentByQuoteId(conversationId, messageId, JSON.stringify(quoteItem))
    }

    jobDao.insert({
      job_id: uuidv4(),
      action: 'RECALL_MESSAGE',
      created_at: new Date().toISOString(),
      order_id: null,
      priority: 5,
      user_id: null,
      blaze_message: btoa(
        unescape(
          encodeURIComponent(
            JSON.stringify({
              message_id: messageId
            })
          )
        )
      ),
      conversation_id: conversationId,
      resend_message_id: null,
      run_count: 0
    })
    commit('refreshMessage', { conversationId, messageIds: [messageId] })
  },
  toggleEditor: ({ commit }: any) => {
    commit('toggleEditor')
  }
}
