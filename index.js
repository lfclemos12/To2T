const http = require('http');
const https = require('https');
const querystring = require('querystring');
const fs = require('fs');
const url = require('url');
const crypto = require('crypto');

const port = 3000;
const server = http.createServer();
const scope = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file";
const credentials = require("./auth/client_secret_538831984714-8tshraet5o6rl71bch01h1dngbqaufds.apps.googleusercontent.com.json")["web"];
const client_id = credentials["client_id"];
const client_secret = credentials["client_secret"];
let all_sessions = [];

server.on("request", connection_handler);
function connection_handler(req, res){
    console.log(`New Request for ${req.url} from ${req.socket.remoteAddress}`);

    if (req.url === "/"){
        const main = fs.createReadStream('./html/main.html');
        res.writeHead(200, {'Content-Type': 'text/html'});
        main.pipe(res);
    }
    else if (req.url.startsWith("/search")){
        let user_input = url.parse(req.url, true).query;
        const meaning = user_input.ml;
        const state = crypto.randomBytes(20).toString("hex");
        all_sessions.push({meaning, state});
        redirect_to_gd(state, res);
    }
    else if (req.url.startsWith("/receive_code")){
        const {state, code} = url.parse(req.url, true).query;
        let session = all_sessions.find(session => session.state === state);
        if (code === undefined || state === undefined || session === undefined){
            not_found(res);
            return;
        }
        const {meaning} = session;
        request_gd_token(code, {meaning}, res);
    }
    else {
        not_found(res);
    }
}

function not_found(res){
    res.writeHead(404, {"Content-Type":"text/html"});
    res.end(`<h1>404 Not found</h1>`);
}

function stream_to_message(stream, callback, ...args){
    let body = "";
    stream.on("data", chunk => body += chunk);
    stream.on("end", () => callback(body, ...args));
}

function redirect_to_gd(state, res) {
    const auth_endpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    let uri = querystring.stringify({
        client_id: client_id,
        redirect_uri: "http://localhost:3000/receive_code",
        response_type: "code",
        scope: scope,
        access_type: "offline",
        state: state
    });
    res.writeHead(302, { Location: `${auth_endpoint}?${uri}` }).end();
}

function request_gd_token(code, user_input, res) {
    const token_endpoint = "https://oauth2.googleapis.com/token";
    const post_data = querystring.stringify({
        client_id: client_id,
        client_secret: client_secret,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: "http://localhost:3000/receive_code" 
    });
    let options = {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        }
    };
    https.request(
        token_endpoint,
        options,
        (token_stream) => stream_to_message(token_stream, receive_gd_token, user_input, res)
    ).end(post_data);
}

function receive_gd_token(message, user_input, res) {
    const { access_token } = JSON.parse(message);
    dm_search_request(user_input, access_token, res);
}

function dm_search_request(user_input, access_token, res) {
    const { meaning } = user_input;
    let dm_endpoint = `https://api.datamuse.com/words?ml=${meaning}`;

    const options = {
        method: "GET",
    };
    https.request(
        dm_endpoint,
        options,
        (words_stream) => stream_to_message(words_stream, receive_words, user_input, access_token, res)
    ).end();
}

function receive_words(message, user_input, access_token, res){
    const words = JSON.parse(message);
    gd_upload(words, user_input, access_token, res);
}

function gd_upload(words, { meaning }, access_token, res) {
    const gd_endpoint = "https://www.googleapis.com/upload/drive/v2/files";
    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${access_token}`
        }
    };
    const post_data = JSON.stringify({
        title: `${meaning}_file.json`, // Add a title for the file
        mimeType: "application/json",
        description: "Data from Datamuse API",
        content: JSON.stringify(words)
    });

    https.request(
        gd_endpoint,
        options,
        (upload_stream) => stream_to_message(upload_stream, gd_upload_response, res)
    ).end(post_data);
}

function gd_upload_response(message, res) {
    const file_info = JSON.parse(message);
    res.writeHead(302, { Location: file_info["alternateLink"] }).end();
}

server.on("listening", listening_handler);
function listening_handler(){
    console.log(`Now Listening on Port ${port}`);
}

server.listen(port);
