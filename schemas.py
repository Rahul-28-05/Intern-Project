from pydantic import BaseModel
from typing import Dict, List, Optional, Literal
from datetime import datetime

class ReactionData(BaseModel):
    emoji: Dict[str, List[str]] = {}  

class Message(BaseModel):
    id: str
    type: Literal["message", "join", "leave", "reaction", "add_reaction", "remove_reaction"]
    user: str
    content: Optional[str] = None
    timestamp: datetime
    reactions: ReactionData = ReactionData()
    online: Optional[List[str]] = None  
class MessageBroadcast(BaseModel):
    type: Literal["message", "join", "leave", "reaction", "reaction_update", "add_reaction", "remove_reaction"]
    user: str
    content: Optional[str] = None
    message_id: Optional[str] = None  
    reactions: Optional[ReactionData] = None
    emoji: Optional[str] = None  
    users: Optional[List[str]] = None  
    online: Optional[List[str]] = None
    timestamp: Optional[datetime] = None

class ReactionRequest(BaseModel):
    type: Literal["reaction"]
    message_id: str
    emoji: str
    action: Literal["add", "remove"]

class AddReactionRequest(BaseModel):
    type: Literal["add_reaction"]
    message_id: str
    emoji: str

class RemoveReactionRequest(BaseModel):
    type: Literal["remove_reaction"]
    message_id: str
    emoji: str

class MessageRequest(BaseModel):
    type: Literal["message"]
    content: str

class CallRequest(BaseModel):
    type: Literal["call_offer"]
    from_user: str
    to_user: str
    call_type: Literal["audio", "video"] 

class CallResponse(BaseModel):
    type: Literal["call_answer"]
    from_user: str
    to_user: str
    accepted: bool
    sdp: Optional[str] = None  
class ICECandidate(BaseModel):
    type: Literal["ice_candidate"]
    from_user: str
    to_user: str
    candidate: dict  
