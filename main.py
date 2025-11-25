from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from typing import Dict, List, Union, Optional
from starlette.requests import Request
from datetime import datetime
import uvicorn, json, uuid
from pydantic import ValidationError, BaseModel
from .schemas import Message, MessageBroadcast, ReactionRequest, MessageRequest, ReactionData, AddReactionRequest, RemoveReactionRequest

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

class CallOffer(BaseModel):
    type: str = "call_offer"
    from_user: str
    to_user: str
    call_type: str  
    sdp: Optional[dict] = None  

class CallAnswer(BaseModel):
    type: str = "call_answer"
    from_user: str
    to_user: str
    sdp: Optional[dict] = None
    accepted: bool

class ICECandidate(BaseModel):
    type: str = "ice_candidate"
    from_user: str
    to_user: str
    candidate: dict

class ConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, List[WebSocket]] = {}
        self.users: Dict[str, Dict[int, str]] = {}
        self.messages: Dict[str, Dict[str, Message]] = {}

    async def connect(self, room: str, username: str, websocket: WebSocket):
        await websocket.accept()
        self.rooms.setdefault(room, []).append(websocket)
        self.users.setdefault(room, {})[id(websocket)] = username
        await self.broadcast(room, {"type": "join", "user": username, "online": list(self.users[room].values())})

    async def disconnect(self, room: str, websocket: WebSocket):
        if room in self.rooms and websocket in self.rooms[room]:
            self.rooms[room].remove(websocket)
            if room in self.users and id(websocket) in self.users[room]:
                username = self.users[room].pop(id(websocket))
                await self.broadcast(room, {"type": "leave", "user": username, "online": list(self.users[room].values())})
            if not self.rooms[room]:
                del self.rooms[room]
                if room in self.users:
                    del self.users[room]

    def store_message(self, room: str, message: Message) -> None:
        self.messages.setdefault(room, {})[message.id] = message
    
    def get_message(self, room: str, message_id: str) -> Optional[Message]:
        return self.messages.get(room, {}).get(message_id)
    
    def verify_user_in_room(self, room: str, username: str) -> bool:
        if room not in self.users:
            return False
        return username in self.users[room].values()
    
    def add_reaction(self, room: str, message_id: str, emoji: str, username: str) -> bool:
        message = self.get_message(room, message_id)
        if not message:
            return False
        if emoji not in message.reactions.emoji:
            message.reactions.emoji[emoji] = []
        if username not in message.reactions.emoji[emoji]:
            message.reactions.emoji[emoji].append(username)
        return True
    
    def remove_reaction(self, room: str, message_id: str, emoji: str, username: str) -> bool:
        message = self.get_message(room, message_id)
        if not message:
            return False
        if emoji in message.reactions.emoji and username in message.reactions.emoji[emoji]:
            message.reactions.emoji[emoji].remove(username)
            if not message.reactions.emoji[emoji]:
                del message.reactions.emoji[emoji]
            return True
        return False

    async def broadcast(self, room: str, message: Union[dict, MessageBroadcast]):
        if room in self.rooms:
            if isinstance(message, MessageBroadcast):
                message_data = message.model_dump(exclude_none=True)
                if "timestamp" in message_data and message_data["timestamp"]:
                    message_data["timestamp"] = message_data["timestamp"].isoformat()
                if "reactions" in message_data and message_data["reactions"]:
                    message_data["reactions"] = message_data["reactions"]["emoji"]
            else:
                message_data = message
            message_text = json.dumps(message_data)
            disconnected = []
            for websocket in self.rooms[room]:
                try:
                    await websocket.send_text(message_text)
                except:
                    disconnected.append(websocket)
            for websocket in disconnected:
                await self.disconnect(room, websocket)

    # --- Direct send (for WebRTC signaling) ---
    async def send_to_user(self, room: str, target_username: str, message: dict):
        if room not in self.rooms:
            return
        for ws in self.rooms[room]:
            if self.users[room].get(id(ws)) == target_username:
                try:
                    await ws.send_text(json.dumps(message))
                except:
                    await self.disconnect(room, ws)

    # --- Call handling ---
    async def handle_call_offer(self, room: str, offer: CallOffer):
        await self.send_to_user(room, offer.to_user, offer.dict())

    async def handle_call_answer(self, room: str, answer: CallAnswer):
        await self.send_to_user(room, answer.to_user, answer.dict())

    async def handle_ice_candidate(self, room: str, candidate: ICECandidate):
        await self.send_to_user(room, candidate.to_user, candidate.dict())


manager = ConnectionManager()

@app.get("/")
async def get_index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.websocket("/ws/{room}/{username}")
async def websocket_endpoint(websocket: WebSocket, room: str, username: str):
    await manager.connect(room, username, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            if message_data["type"] == "message":
                try:
                    message_request = MessageRequest(**message_data)
                except ValidationError:
                    continue
                message_id = str(uuid.uuid4())
                message = Message(
                    id=message_id,
                    type="message",
                    user=username,
                    content=message_request.content,
                    timestamp=datetime.now(),
                    reactions=ReactionData()
                )
                manager.store_message(room, message)
                broadcast_message = MessageBroadcast(
                    type="message",
                    user=username,
                    content=message_request.content,
                    message_id=message_id,
                    reactions=message.reactions,
                    timestamp=message.timestamp
                )
                await manager.broadcast(room, broadcast_message)

            elif message_data["type"] == "add_reaction":
                try:
                    add_reaction_request = AddReactionRequest(**message_data)
                except ValidationError:
                    continue
                if not manager.verify_user_in_room(room, username):
                    continue
                success = manager.add_reaction(room, add_reaction_request.message_id, add_reaction_request.emoji, username)
                if success:
                    updated_message = manager.get_message(room, add_reaction_request.message_id)
                    if updated_message:
                        users_for_emoji = updated_message.reactions.emoji.get(add_reaction_request.emoji, [])
                        reaction_update = MessageBroadcast(
                            type="reaction_update",
                            user=username,
                            message_id=add_reaction_request.message_id,
                            emoji=add_reaction_request.emoji,
                            users=users_for_emoji,
                            reactions=updated_message.reactions
                        )
                        await manager.broadcast(room, reaction_update)

            elif message_data["type"] == "remove_reaction":
                try:
                    remove_reaction_request = RemoveReactionRequest(**message_data)
                except ValidationError:
                    continue
                if not manager.verify_user_in_room(room, username):
                    continue
                success = manager.remove_reaction(room, remove_reaction_request.message_id, remove_reaction_request.emoji, username)
                if success:
                    updated_message = manager.get_message(room, remove_reaction_request.message_id)
                    if updated_message:
                        users_for_emoji = updated_message.reactions.emoji.get(remove_reaction_request.emoji, [])
                        reaction_update = MessageBroadcast(
                            type="reaction_update",
                            user=username,
                            message_id=remove_reaction_request.message_id,
                            emoji=remove_reaction_request.emoji,
                            users=users_for_emoji,
                            reactions=updated_message.reactions
                        )
                        await manager.broadcast(room, reaction_update)

            elif message_data["type"] == "reaction":
                try:
                    reaction_request = ReactionRequest(**message_data)
                except ValidationError:
                    continue
                success = False
                if reaction_request.action == "add":
                    success = manager.add_reaction(room, reaction_request.message_id, reaction_request.emoji, username)
                elif reaction_request.action == "remove":
                    success = manager.remove_reaction(room, reaction_request.message_id, reaction_request.emoji, username)
                if success:
                    updated_message = manager.get_message(room, reaction_request.message_id)
                    if updated_message:
                        users_for_emoji = updated_message.reactions.emoji.get(reaction_request.emoji, [])
                        reaction_update = MessageBroadcast(
                            type="reaction_update",
                            user=username,
                            message_id=reaction_request.message_id,
                            emoji=reaction_request.emoji,
                            users=users_for_emoji,
                            reactions=updated_message.reactions
                        )
                        await manager.broadcast(room, reaction_update)

            # --- Call / WebRTC signaling ---
            elif message_data["type"] == "call_offer":
                call_offer = CallOffer(**message_data)
                await manager.handle_call_offer(room, call_offer)

            elif message_data["type"] == "call_answer":
                call_answer = CallAnswer(**message_data)
                await manager.handle_call_answer(room, call_answer)

            elif message_data["type"] == "ice_candidate":
                ice_candidate = ICECandidate(**message_data)
                await manager.handle_ice_candidate(room, ice_candidate)

    except WebSocketDisconnect:
        await manager.disconnect(room, websocket)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
