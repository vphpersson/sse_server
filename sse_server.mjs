#!/usr/bin/env node

import http from 'http';

import {ArgumentParser} from 'argparse';

/**
 * Make an SSE entry from a field name and its corresponding value.
 *
 * @param {string} field - The field which to set in the SSE entry.
 * @param {string} value - The value of the field.
 * @returns {string} - An SSE entry.
 */
function make_sse_entry(field, value) {
    return value.split('\n').reduce(
        (accumulator, current_value) => accumulator + `${field}: ${current_value}\n`,
        ''
    );
}

class SSEConnection {
    /**
     * @param {http.ServerResponse} server_response - An HTTP response of an SSE connection.
     */
    constructor(server_response) {
        this.id_counter = 0;
        this.server_response = server_response;
    }
}

class SSEServer {
    constructor() {
        this.url_path_to_connection = new Map();
    }

    /**
     * Handle incoming HTTP messages.
     *
     * A connection is uniquely identified by a URL path.
     *
     * @param {http.IncomingMessage} incoming_message - An incoming HTTP message.
     * @param {http.ServerResponse} server_response - An HTTP response.
     */
    handle_incoming_message(incoming_message, server_response) {
        console.log(`Received a message from ${incoming_message.connection.remoteAddress}`);

        const sse_connection = this.url_path_to_connection.get(incoming_message.url);

        switch (incoming_message.method) {
            // Establish a new SSE connection.
            case 'GET': {
                if (sse_connection !== undefined) {
                    const msg = `An SSE connection already exists for URL path: ${incoming_message.url}`;
                    server_response.writeHead(400, {'Content-Type': 'text/plain'});
                    server_response.end(msg);
                    return void console.warn(msg);
                }

                server_response.on('close', () => {
                    console.log(`Closing ${incoming_message.url}.`)
                    this.url_path_to_connection.delete(incoming_message.url);
                });

                console.log(`Creating a new connection for ${incoming_message.url}.`)
                this.url_path_to_connection.set(incoming_message.url, new SSEConnection(server_response));

                server_response.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });
                server_response.write(make_sse_entry('retry', '3000') + '\n');

                break;
            }
            // Send data in an existing SSE connection.
            case 'POST': {
                if (sse_connection === undefined) {
                    const msg = `No SSE connection for URL path: ${incoming_message.url}`;
                    server_response.writeHead(400, {'Content-Type': 'text/plain'});
                    server_response.end(msg);
                    return void console.warn(msg);
                }

                console.log(`Receiving data for ${incoming_message.url}.`)

                let body = '';
                incoming_message.on('data', data => body += data);
                incoming_message.on('end', () => {
                    try {
                        const json_body = JSON.parse(body);

                        sse_connection.server_response.write(make_sse_entry('id', String(sse_connection.id_counter++)));
                        if (json_body.event !== undefined)
                            sse_connection.server_response.write(make_sse_entry('event', json_body.event));
                        sse_connection.server_response.write(make_sse_entry('data', json_body.data) + '\n');
                    } catch (err) {
                        console.warn(err);
                        server_response.writeHead(400, {'Content-Type': 'text/plain'});
                        server_response.end('Bad JSON data.');
                    }
                });

                server_response.writeHead(200);
                server_response.end();

                break;
            }
            default: {
                const msg = `Bad /sse HTTP method: ${incoming_message.method}`;
                server_response.writeHead(400, {'Content-Type': 'text/plain'});
                server_response.end(msg);
                return void console.warn(msg);
            }
        }
    }
}

class SSEServerArgumentParser extends ArgumentParser {
    constructor(...args) {
        super(...args);

        this.add_argument('-b', '--bind', {
            help: 'The address on which the server should listen.',
            default: '127.0.0.1'
        });

        this.add_argument('-p', '--port', {
            help: 'The port on which the server should listen',
            type: 'int',
            default: 8787
        });

        this.add_argument('-a', '--allow-all-origins', {
            help: 'Allow all origins to access the server resources.',
            action: 'store_true'
        })
    }
}

function main() {
    const {
        bind: listening_address,
        port: listening_port,
        allow_all_origins
    } = new SSEServerArgumentParser().parse_args();

    const sse_server = new SSEServer();

    http.createServer((incoming_message, server_response) => {
        if (allow_all_origins)
            server_response.setHeader('Access-Control-Allow-Origin', '*');
        sse_server.handle_incoming_message(incoming_message, server_response);
    }).listen(listening_port, listening_address);

    console.log(`Starting SSE server on ${listening_address}:${listening_port}.`)
}

main();
