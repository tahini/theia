/********************************************************************************
 * Copyright (C) 2018 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
/* eslint-env browser */
/* eslint-disable import/newline-after-import */
// use higher-precision time than milliseconds
process.hrtime = require('browser-process-hrtime');
import { injectable, interfaces, decorate, unmanaged } from 'inversify';
import { JsonRpcProxyFactory, JsonRpcProxy } from '../../common';
import { WebSocketChannel } from '../../common/messaging/web-socket-channel';
import { Endpoint } from '../endpoint';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { AbstractConnectionProvider } from '../../common/messaging/abstract-connection-provider';
const { Annotation, Tracer, ExplicitContext } = require('zipkin');
// const CLSContext = require('zipkin-context-cls');
const { recorder } = require('recorder/recorder');

const ctxImpl = new ExplicitContext();
const localServiceName = 'browser';
const tracer = new Tracer({ ctxImpl, recorder: recorder(localServiceName), localServiceName });

decorate(injectable(), JsonRpcProxyFactory);
decorate(unmanaged(), JsonRpcProxyFactory, 0);

export interface WebSocketOptions {
    /**
     * True by default.
     */
    reconnecting?: boolean;
}

@injectable()
export class WebSocketConnectionProvider extends AbstractConnectionProvider<WebSocketOptions> {

    static createProxy<T extends object>(container: interfaces.Container, path: string, arg?: object): JsonRpcProxy<T> {
        return container.get(WebSocketConnectionProvider).createProxy<T>(path, arg);
    }

    protected channelIdSeq = 200;
    protected indexSeq = 0;
    id = 0;
    index = 0;
    protected readonly socket: ReconnectingWebSocket;
    protected readonly channels = new Map<number, WebSocketChannel>();
    tracerIds = new Map();
    channelIds = new Map<number, Number>();

    constructor() {
        super();
        const url = this.createWebSocketUrl(WebSocketChannel.wsPath);
        const socket = this.createWebSocket(url);
        socket.onerror = console.error;
        socket.onclose = ({ code, reason }) => {
            for (const channel of [...this.channels.values()]) {
                channel.close(code, reason);
            }
        };
        socket.onmessage = ({ data }) => {
            this.handleIncomingRawMessage(data);
            const msg = JSON.parse(data.toString());
            // var text = '{ "name":"John", "birth":"1986-12-14", "city":"New York"}';
            if (msg.content) {
                const obj = JSON.parse(msg.content.toString(), (key, value) => {
                    if (key === 'result') {
                        return 1;
                    } else {
                        return value;
                    }
                });
                // const cont = JSON.parse(msg);
                // console.log(obj.id);
                const tr = this.tracerIds.get(obj.id);
                if (tr) {
                    // console.log(json2.id);
                    tracer.setId(tr);
                    // const traceId = tracer.id;

                    tracer.scoped(async () => {

                        tracer.recordServiceName(localServiceName);
                        // tracer.recordBinary('result.id', obj.id);
                        // tracer.recordBinary('spanIdrec', tracer.id.spanId);
                        // tracer.recordBinary('dir', 'cl');
                        tracer.recordAnnotation(new Annotation.ClientRecv());

                    });
                    this.channelIds.delete(obj.id);
                    this.tracerIds.delete(obj.id);
                }
            }
        };
        this.socket = socket;
    }

    openChannel(path: string, handler: (channel: WebSocketChannel) => void, options?: WebSocketOptions): void {
        if (this.socket.readyState === WebSocket.OPEN) {
            super.openChannel(path, handler, options);
        } else {
            const openChannel = () => {

                this.socket.removeEventListener('open', openChannel);
                this.openChannel(path, handler, options);
            };
            this.socket.addEventListener('open', openChannel);
        }
    }

    protected createChannel(id: number): WebSocketChannel {
        this.index = 100 + this.indexSeq++;
        return new WebSocketChannel(id, content => {
            if (this.socket.readyState < WebSocket.CLOSING) {
                const json = JSON.parse(content);
                tracer.setId(tracer.createChildId());
                const traceId = tracer.id;
                // console.log(json);
                if (json.content) {
                    const json2 = JSON.parse(json.content);
                    json2['parentId'] = tracer.id.traceId;
                    json2['spanId'] = tracer.id.spanId;
                    json2['sampled'] = tracer.id.sampled;
                    json2['flags'] = tracer.id.flags;
                    json.content = JSON.stringify(json2);
                    const newcontent = JSON.stringify(json);
                    // console.log(json2);
                    tracer.scoped(async () => {
                        tracer.recordServiceName(localServiceName);
                        if (json2.id) {
                            tracer.recordBinary('payload.id', json2.id);
                        }
                        tracer.recordBinary('channel.id', id);
                        tracer.recordBinary('spanId', tracer.id.spanId);
                        tracer.recordBinary('dir', 'cl');
                        tracer.recordBinary('operationName', (json2.method ? json2.method : 'unknown'));
                        tracer.recordAnnotation(new Annotation.ClientSend());
                        this.socket.send(newcontent);
                        this.channelIds.set(json2.id, id);
                        this.tracerIds.set(json2.id, traceId);
                    });
                } else {
                    this.socket.send(content);
                }

            }
        }, this.index);
    }

    /**
     * Creates a websocket URL to the current location
     */
    protected createWebSocketUrl(path: string): string {
        const endpoint = new Endpoint({ path });
        return endpoint.getWebSocketUrl().toString();
    }

    /**
     * Creates a web socket for the given url
     */
    protected createWebSocket(url: string): ReconnectingWebSocket {
        return new ReconnectingWebSocket(url, undefined, {
            maxReconnectionDelay: 10000,
            minReconnectionDelay: 1000,
            reconnectionDelayGrowFactor: 1.3,
            connectionTimeout: 10000,
            maxRetries: Infinity,
            debug: false
        });
    }

}
