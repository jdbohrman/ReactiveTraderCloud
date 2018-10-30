import _ from 'lodash'
import React, { PureComponent } from 'react'

import MediaRecorder, { BlobEvent } from './MediaRecorderComponent'

import * as GreenKeyRecognition from './GreenKeyRecognition'
import { Timer } from './Timer'

import { WebSocketConnection, WebSocketEventHandles } from './WebSocketConnection'

// tslint:disable-next-line
export interface SessionResultData extends GreenKeyRecognition.Result {}
export interface SessionResult {
  data: GreenKeyRecognition.Result
  transcripts: any
}

export interface Props {
  input: MediaStream
  mimeType: string
  bitsPerSecond: number
  onStart?: (event: any) => any
  onBlob?: (event: BlobEvent) => any
  onError?: (event: any) => any
  onResult?: (event: SessionResult) => any
  onEnd?: (event: any) => any
}

interface State {
  recording: boolean

  connected: boolean
  socket?: WebSocket

  error?: boolean
  result?: GreenKeyRecognition.Result
}

export class TranscriptionSession extends PureComponent<Props, State> {
  static defaultProps = {
    mimeType: 'audio/webm',
    bitsPerSecond: 128 * 1000,
  }

  state: State = {
    recording: false,
    connected: false,

    socket: null,

    error: false,
    result: null,
  }

  unmounting: boolean
  componentWillUnmount() {
    this.unmounting = true
  }

  //
  //  MediaRecorder
  //
  recorder?: MediaRecorder

  get chunks(): Blob[] {
    return this.recorder ? this.recorder.chunks : []
  }

  setRecorder = (recorder: MediaRecorder | null) => {
    if (recorder) {
      this.recorder = recorder
    }
  }

  onRecorderStart = () => this.setState({ recording: true })
  onRecorderData = (event: BlobEvent) => {
    const { onBlob } = this.props
    const { socket } = this.state

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(event.data)
    } else {
      console.warn('TranscriptionSession received audio data but socket in not open')
    }

    if (onBlob) {
      onBlob(event)
    }
  }

  //
  //  WebSocket
  //
  createWebSocket = (handles: WebSocketEventHandles) =>
    GreenKeyRecognition.createWebSocket({ contentType: this.props.mimeType, ...handles })

  onOpen = ({ target }: Event & { target: WebSocket }) => {
    this.setState({
      connected: true,
      socket: target,
    })
  }

  onMessage = (event: MessageEvent) => {
    if (this.unmounting) {
      console.error('TranscriptionSession.onMessage occured after unmount')

      return
    }

    const data = JSON.parse(event.data)

    this.setState({ result: data.result })

    if (this.props.onResult) {
      this.props.onResult({
        data,
        transcripts: _.map(data.segments, 'clean_transcript').map(transcript => [{ transcript }]),
      })
    }
  }

  onError = (error: Error | ErrorEvent) => {
    if (this.unmounting) {
      console.error('Unexpected call to TranscriptionSession.onError')

      return
    }

    this.setState({
      error: true,
      socket: null,
      connected: false,
    })

    if (this.props.onError) {
      this.props.onError({ ok: false, source: 'socket', error })
    }
  }

  onMarkedFinalTimeout = () => {
    console.info('Marked final')

    this.onClose()
  }

  onClose = () => {
    if (this.unmounting) {
      return
    }

    this.setState({ socket: null, connected: false, recording: false }, () => {
      if (this.props.onEnd) {
        this.props.onEnd(null)
      }
    })
  }

  render() {
    const { input, mimeType, bitsPerSecond } = this.props
    const { recording, connected, result } = this.state

    return (
      <React.Fragment>
        <MediaRecorder
          ref={this.setRecorder}
          input={input}
          rate={GreenKeyRecognition.interval}
          mimeType={mimeType}
          bitsPerSecond={bitsPerSecond}
          onStart={this.onRecorderStart}
          onDataAvailable={this.onRecorderData}
          requestData={connected}
        />

        {recording && (
          <WebSocketConnection
            create={this.createWebSocket}
            onOpen={this.onOpen}
            onMessage={this.onMessage}
            onError={this.onError}
            onClose={this.onClose}
          />
        )}

        {result &&
          result.final && (
            // Provide time 1s window for user to continue speaking
            <Timer duration={1000} timeout={this.onMarkedFinalTimeout} />
          )}
      </React.Fragment>
    )
  }
}

export default TranscriptionSession