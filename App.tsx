import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { auth, db, storage } from './services/firebase';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { 
  collection, query, where, onSnapshot, addDoc, 
  serverTimestamp, doc, setDoc, getDoc, getDocs, updateDoc, orderBy, deleteDoc, arrayUnion, limit 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { User, Chat, Room, Message, FriendRequest, Story, Viewer } from './types';
import { Icons } from './components/Icons';

// --- Background Component ---
const BalochBackground = React.memo(() => (
  <div className="fixed inset-0 z-0 pointer-events-none flex items-center justify-center overflow-hidden">
    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10"></div>
    <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-purple-900/20 to-transparent"></div>
    <div className="absolute bottom-0 right-0 w-full h-1/2 bg-gradient-to-t from-yellow-600/10 to-transparent"></div>
    <h1 className="font-display font-black text-[120px] md:text-[200px] text-white/[0.03] tracking-widest rotate-[-15deg] select-none">
      BALOCH
    </h1>
  </div>
));

// --- Optimized List Items ---
const ChatItem = React.memo(({ chat, user, onClick }: { chat: Chat, user: User | null, onClick: () => void }) => {
    const pid = chat.participants.find(p => p !== user?.uid);
    return (
        <div onClick={onClick} className="flex items-center gap-4 p-4 bg-white/5 border border-white/5 rounded-3xl active:scale-[0.98] transition-all hover:bg-white/10 cursor-pointer backdrop-blur-sm">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xl shadow-lg shrink-0">
                {pid?.slice(0,1).toUpperCase() || "?"}
            </div>
            <div className="flex-1 min-w-0">
                <h3 className="font-bold text-white text-lg">User ({pid?.slice(0,5)}...)</h3>
                <p className="text-sm text-gray-400 truncate">{chat.lastMessage}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] text-gray-500">Just Now</span>
                {chat.unreadCount ? <div className="w-2 h-2 rounded-full bg-yellow-500"></div> : null}
            </div>
        </div>
    );
});

const MessageBubble = React.memo(({ msg, isMe }: { msg: Message, isMe: boolean }) => (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[75%] p-4 rounded-2xl text-[15px] shadow-sm ${isMe ? 'bg-gradient-to-br from-yellow-600 to-yellow-800 text-white rounded-tr-sm' : 'bg-[#1F1F1F] text-gray-200 rounded-tl-sm'}`}>
            {msg.text}
            <div className={`text-[10px] mt-1 text-right ${isMe ? 'text-yellow-200' : 'text-gray-500'}`}>
                {msg.createdAt ? new Date(msg.createdAt.toMillis()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}
            </div>
        </div>
    </div>
));

export default function App() {
  // --- State ---
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'auth' | 'home' | 'chat' | 'room'>('auth');
  const [loading, setLoading] = useState(true);
  
  // Auth State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [dpFile, setDpFile] = useState<File | null>(null);

  // Data State
  const [chats, setChats] = useState<Chat[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [activeTab, setActiveTab] = useState<'chats' | 'rooms' | 'status'>('chats');
  
  // Active Interactions
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [activeChatUser, setActiveChatUser] = useState<User | null>(null);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgText, setMsgText] = useState('');
  const [micActive, setMicActive] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);

  // Story Interactions
  const [showStoryUpload, setShowStoryUpload] = useState(false);
  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [storyCaption, setStoryCaption] = useState('');
  const [viewingStory, setViewingStory] = useState<Story | null>(null);
  const [showViewers, setShowViewers] = useState(false);

  // UI State
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');

  // --- Effects ---

  // 1. Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        // Cached read first due to persistence
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
          setUser(userDoc.data() as User);
          setView('home');
        } else {
          signOut(auth); 
        }
      } else {
        setUser(null);
        setView('auth');
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // 2. Data Listeners (Optimized with limits)
  useEffect(() => {
    if (!user) return;

    // Limit chats to active ones roughly (not easily limited by query due to array-contains, but usually small list)
    const qChats = query(collection(db, 'chats'), where('participants', 'array-contains', user.uid));
    const unsubChats = onSnapshot(qChats, (snapshot) => {
      const chatsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Chat));
      // Sort in JS
      chatsData.sort((a, b) => (b.lastMessageTime?.toMillis() || 0) - (a.lastMessageTime?.toMillis() || 0));
      setChats(chatsData);
    });

    // Rooms (usually few active rooms, keep as is)
    const qRooms = query(collection(db, 'rooms'), limit(20));
    const unsubRooms = onSnapshot(qRooms, (snapshot) => {
      setRooms(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Room)));
    });

    const qReq = query(collection(db, 'requests'), where('toUid', '==', user.uid), where('status', '==', 'pending'));
    const unsubReq = onSnapshot(qReq, (snapshot) => {
      setRequests(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as FriendRequest)));
    });

    // Optimize Stories: Limit to 20 recent
    const qStories = query(collection(db, 'stories'), orderBy('createdAt', 'desc'), limit(20));
    const unsubStories = onSnapshot(qStories, (snapshot) => {
      const allStories = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Story));
      const now = Date.now();
      const validStories = allStories.filter(s => {
        const time = s.createdAt?.toMillis() || 0;
        return (now - time) < 24 * 60 * 60 * 1000;
      });
      setStories(validStories);
    });

    return () => {
      unsubChats();
      unsubRooms();
      unsubReq();
      unsubStories();
    };
  }, [user]);

  // 3. Messages Listener (Optimized)
  useEffect(() => {
    if (!activeChat) return;
    // Get last 50 messages only (Data Saver)
    const qMsgs = query(
        collection(db, 'chats', activeChat.id, 'messages'), 
        orderBy('createdAt', 'desc'), 
        limit(50)
    );
    const unsubMsgs = onSnapshot(qMsgs, (snapshot) => {
      // Reverse because we queried desc for limit, but want asc for display
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message)).reverse();
      setMessages(msgs);
    });
    return unsubMsgs;
  }, [activeChat]);

  // 4. Room Audio Cleanup
  useEffect(() => {
    if (view !== 'room' && audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      setAudioStream(null);
      setMicActive(false);
    }
  }, [view]);

  // --- Handlers ---
  const handleImageUpload = async (file: File, path: string): Promise<string> => {
    // Compress image logic would go here for further data saving
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const qUser = query(collection(db, 'users'), where('username', '==', username));
        const snap = await getDocs(qUser);
        if (!snap.empty) {
          alert("Username already taken!");
          return;
        }

        const cred = await createUserWithEmailAndPassword(auth, email, password);
        
        let photoURL = `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`;
        if (dpFile) {
            photoURL = await handleImageUpload(dpFile, `profile_pictures/${cred.user.uid}`);
        }

        const userData: User = {
          uid: cred.user.uid,
          email: cred.user.email,
          username: username,
          displayName: username,
          photoURL: photoURL,
          isOnline: true
        };
        await setDoc(doc(db, 'users', cred.user.uid), userData);
        await updateProfile(cred.user, { displayName: username, photoURL: photoURL });
        setUser(userData);
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const sendFriendRequest = async () => {
    if (!user || !friendSearch) return;
    const q = query(collection(db, 'users'), where('username', '==', friendSearch));
    const snap = await getDocs(q);
    
    if (snap.empty) {
      alert("User not found!");
      return;
    }

    const targetUser = snap.docs[0].data() as User;
    if (targetUser.uid === user.uid) {
      alert("You cannot add yourself.");
      return;
    }
    
    await addDoc(collection(db, 'requests'), {
      fromUid: user.uid,
      fromName: user.displayName,
      fromPhoto: user.photoURL,
      toUid: targetUser.uid,
      status: 'pending',
      createdAt: serverTimestamp()
    });
    
    alert("Request sent!");
    setFriendSearch('');
    setShowAddFriend(false);
  };

  const handleRequest = async (req: FriendRequest, accept: boolean) => {
    if (accept) {
      const chatId = [req.fromUid, user!.uid].sort().join('_');
      await setDoc(doc(db, 'chats', chatId), {
        participants: [req.fromUid, user!.uid],
        lastMessage: 'Chat created',
        lastMessageTime: serverTimestamp()
      });
    }
    await updateDoc(doc(db, 'requests', req.id), { status: accept ? 'accepted' : 'rejected' });
  };

  const openChat = useCallback(async (chat: Chat) => {
    const otherUid = chat.participants.find(p => p !== user?.uid);
    if (otherUid) {
      // Offline persistence makes this instant if cached
      const uDoc = await getDoc(doc(db, 'users', otherUid));
      if (uDoc.exists()) {
        setActiveChatUser(uDoc.data() as User);
        setActiveChat(chat);
        setView('chat');
      }
    }
  }, [user]);

  const sendMessage = async () => {
    if (!msgText.trim() || !activeChat || !user) return;
    const txt = msgText;
    setMsgText('');
    await addDoc(collection(db, 'chats', activeChat.id, 'messages'), {
      senderId: user.uid,
      text: txt,
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'chats', activeChat.id), {
      lastMessage: txt,
      lastMessageTime: serverTimestamp()
    });
  };

  const createRoom = async () => {
    if (!user) return;
    const roomName = prompt("Enter Party Room Name:");
    if (!roomName) return;
    const newRoomRef = await addDoc(collection(db, 'rooms'), {
      name: roomName,
      hostUid: user.uid,
      hostName: user.displayName,
      hostPhoto: user.photoURL,
      speakers: [user.uid],
      viewers: 0
    });
    joinRoom({ 
      id: newRoomRef.id, 
      name: roomName, 
      hostUid: user.uid, 
      hostName: user.displayName, 
      hostPhoto: user.photoURL, 
      speakers: [user.uid], 
      viewers: 0 
    });
  };

  const joinRoom = async (room: Room) => {
    setActiveRoom(room);
    setView('room');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000
            },
            video: false
        });
        setAudioStream(stream);
        setMicActive(true);
    } catch (e) {
        console.error("Mic access denied or error", e);
    }
  };

  const toggleMic = () => {
      if (audioStream) {
          const enabled = !micActive;
          audioStream.getAudioTracks().forEach(track => track.enabled = enabled);
          setMicActive(enabled);
      }
  };

  const leaveRoom = async () => {
    if (!activeRoom || !user) {
        setView('home');
        return;
    }
    const updatedSpeakers = activeRoom.speakers.filter(uid => uid !== user.uid);
    await updateDoc(doc(db, 'rooms', activeRoom.id), {
        speakers: updatedSpeakers
    });
    setActiveRoom(null);
    setView('home');
  };

  const uploadStory = async () => {
    if(!storyFile || !user) return;
    setLoading(true);
    try {
        // In a real optimized app, we would resize the image here client-side before upload
        const url = await handleImageUpload(storyFile, `stories/${user.uid}/${Date.now()}`);
        await addDoc(collection(db, 'stories'), {
            uid: user.uid,
            username: user.displayName,
            userPhoto: user.photoURL,
            imageUrl: url,
            text: storyCaption,
            createdAt: serverTimestamp(),
            views: []
        });
        setShowStoryUpload(false);
        setStoryFile(null);
        setStoryCaption('');
    } catch (error) {
        alert("Failed to upload story");
    }
    setLoading(false);
  };

  const openStory = (story: Story) => {
    setViewingStory(story);
    if(user && story.uid !== user.uid) {
        const hasViewed = story.views?.some(v => v.uid === user.uid);
        if(!hasViewed) {
            const viewData: Viewer = {
                uid: user.uid,
                name: user.displayName,
                photo: user.photoURL,
                viewedAt: new Date().toISOString()
            };
            // Fire and forget update
            updateDoc(doc(db, 'stories', story.id), {
                views: arrayUnion(viewData)
            });
        }
    }
  };

  const deleteStory = async (storyId: string) => {
    if(confirm("Delete this story?")) {
        await deleteDoc(doc(db, 'stories', storyId));
        setViewingStory(null);
    }
  };

  const changeProfilePic = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if(e.target.files && e.target.files[0] && user) {
        const file = e.target.files[0];
        setLoading(true);
        try {
            const url = await handleImageUpload(file, `profile_pictures/${user.uid}`);
            await updateDoc(doc(db, 'users', user.uid), { photoURL: url });
            await updateProfile(auth.currentUser!, { photoURL: url });
            setUser(prev => prev ? {...prev, photoURL: url} : null);
        } catch(err) {
            alert("Failed to update profile pic");
        }
        setLoading(false);
    }
  };

  // --- Render Views ---

  if (loading) return <div className="h-screen w-screen bg-black flex items-center justify-center text-yellow-500 font-display text-2xl animate-pulse">LOADING...</div>;

  if (view === 'auth') {
    return (
      <div className="h-screen w-screen bg-black flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <BalochBackground />
        <div className="z-10 w-full max-w-md bg-white/5 backdrop-blur-2xl border border-white/10 p-8 rounded-[40px] shadow-2xl relative">
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-24 h-24 bg-gradient-to-tr from-yellow-500 to-purple-600 rounded-full blur-[40px] opacity-60"></div>
          <div className="text-center mb-10 relative">
            <h1 className="font-display text-5xl font-black text-white drop-shadow-[0_0_15px_rgba(234,179,8,0.5)] tracking-tight">JK CHAT</h1>
            <div className="flex items-center justify-center gap-2 mt-2">
                <div className="h-[1px] w-8 bg-gradient-to-r from-transparent to-yellow-500"></div>
                <p className="text-yellow-400 text-xs font-bold tracking-[0.3em] uppercase">Baloch Edition</p>
                <div className="h-[1px] w-8 bg-gradient-to-l from-transparent to-yellow-500"></div>
            </div>
          </div>
          <form onSubmit={handleAuth} className="space-y-5 flex flex-col items-center">
            {!isLogin && (
                <div className="relative w-28 h-28 mb-4 group cursor-pointer transition-transform active:scale-95" onClick={() => document.getElementById('dp-input')?.click()}>
                    <input type="file" id="dp-input" hidden accept="image/*" onChange={(e) => setDpFile(e.target.files?.[0] || null)} />
                    <img 
                        src={dpFile ? URL.createObjectURL(dpFile) : "https://cdn-icons-png.flaticon.com/512/149/149071.png"} 
                        className="w-full h-full rounded-full object-cover border-4 border-yellow-500 shadow-xl shadow-yellow-500/20"
                        decoding="async"
                    />
                    <div className="absolute bottom-1 right-1 bg-yellow-500 p-2 rounded-full text-black border-2 border-black">
                        <Icons.Camera size={16} />
                    </div>
                </div>
            )}
            {!isLogin && (
              <div className="w-full relative">
                  <Icons.User className="absolute left-4 top-4 text-gray-500" size={20}/>
                  <input type="text" placeholder="Username" className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 focus:bg-black/60 transition-all" value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} required />
              </div>
            )}
            <input type="email" placeholder="Email Address" className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 focus:bg-black/60 transition-all" value={email} onChange={e => setEmail(e.target.value)} required />
            <input type="password" placeholder="Password" className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 focus:bg-black/60 transition-all" value={password} onChange={e => setPassword(e.target.value)} required />
            <button className="w-full bg-gradient-to-r from-yellow-500 via-amber-500 to-yellow-600 text-black font-black font-display text-xl py-4 rounded-2xl shadow-lg shadow-yellow-500/20 active:scale-95 transition-all mt-4 flex items-center justify-center gap-2">
              {isLogin ? 'LOGIN' : 'JOIN NOW'}
            </button>
          </form>
          <p className="text-center text-gray-400 text-sm mt-8 cursor-pointer hover:text-white transition-colors" onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? "New to the party? Create Account" : "Already have an account? Login"}
          </p>
        </div>
      </div>
    );
  }

  if (view === 'home') {
    return (
      <div className="h-screen w-screen bg-black flex flex-col relative overflow-hidden">
        <BalochBackground />
        <header className="h-24 pt-4 bg-gradient-to-b from-black via-black/90 to-transparent backdrop-blur-sm flex items-center justify-between px-6 z-20">
          <div className="flex items-center gap-3">
            <div className="relative group cursor-pointer transition-transform active:scale-95">
                <div className="absolute inset-0 bg-yellow-500 rounded-full blur-[4px] opacity-50"></div>
                <img src={user?.photoURL} onClick={() => document.getElementById('edit-dp')?.click()} alt="Me" className="w-12 h-12 rounded-full border-2 border-yellow-500 object-cover relative z-10" decoding="async"/>
                <input type="file" id="edit-dp" hidden accept="image/*" onChange={changeProfilePic}/>
            </div>
            <div>
              <h2 className="font-display font-bold text-2xl text-white tracking-tight">JK CHAT</h2>
              <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <p className="text-xs text-gray-400 font-medium">@{user?.username}</p>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowAddFriend(true)} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center text-yellow-500 transition-colors"><Icons.Plus size={22}/></button>
            <button onClick={() => { signOut(auth); setView('auth'); }} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 hover:bg-red-900/20 flex items-center justify-center text-red-500 transition-colors"><Icons.LogOut size={20}/></button>
          </div>
        </header>

        {requests.length > 0 && (
          <div className="mx-4 mt-2 bg-gradient-to-r from-indigo-900/40 to-purple-900/40 border border-indigo-500/30 p-3 rounded-2xl backdrop-blur-md z-10 relative">
            <p className="text-indigo-300 text-xs font-bold mb-2 uppercase tracking-wide">Friend Requests</p>
            {requests.map(req => (
              <div key={req.id} className="flex justify-between items-center mb-2 last:mb-0">
                <div className="flex items-center gap-2">
                    <img src={req.fromPhoto} className="w-8 h-8 rounded-full" decoding="async"/>
                    <span className="text-white text-sm font-medium">@{req.fromName}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleRequest(req, true)} className="bg-green-500 p-1.5 rounded-lg text-black hover:bg-green-400"><Icons.Check size={16}/></button>
                  <button onClick={() => handleRequest(req, false)} className="bg-red-500 p-1.5 rounded-lg text-white hover:bg-red-400"><Icons.X size={16}/></button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex mx-4 mt-4 bg-white/5 rounded-2xl p-1.5 border border-white/10 relative z-10">
            {['chats', 'status', 'rooms'].map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab as any)} className={`flex-1 py-3 rounded-xl text-xs font-bold font-display uppercase tracking-wider transition-all duration-300 ${activeTab === tab ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/20 scale-[1.02]' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>{tab}</button>
            ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 pb-24 z-10 relative">
            {activeTab === 'chats' && (
                <div className="space-y-3">
                    {chats.map(chat => (
                        <ChatItem key={chat.id} chat={chat} user={user} onClick={() => openChat(chat)} />
                    ))}
                    {chats.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                            <Icons.Chat size={64} className="opacity-20 mb-4"/>
                            <p>No chats yet. Add friends!</p>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'status' && (
                <div className="space-y-6">
                    <div className="flex items-center gap-4 p-2 cursor-pointer group" onClick={() => setShowStoryUpload(true)}>
                         <div className="relative">
                             <div className="absolute inset-0 bg-yellow-500 rounded-full blur opacity-20 group-hover:opacity-40 transition-opacity"></div>
                             <img src={user?.photoURL} className="w-16 h-16 rounded-full border-2 border-gray-600 object-cover relative z-10" decoding="async"/>
                             <div className="absolute bottom-0 right-0 bg-yellow-500 rounded-full p-1.5 border-2 border-black z-20"><Icons.Plus size={14} className="text-black font-bold"/></div>
                         </div>
                         <div>
                             <h3 className="font-bold text-white text-lg">My Status</h3>
                             <p className="text-sm text-gray-400">Tap to add an update</p>
                         </div>
                    </div>

                    <div className="bg-white/5 rounded-3xl p-4 border border-white/5 backdrop-blur-sm">
                        <h4 className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-4">Recent Updates</h4>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                            {stories.map(story => (
                                <div key={story.id} className="flex flex-col items-center gap-2 cursor-pointer group" onClick={() => openStory(story)}>
                                    <div className={`w-18 h-18 rounded-full p-[3px] ${story.views.some(v => v.uid === user?.uid) ? 'bg-gray-700' : 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600'}`}>
                                        <div className="w-full h-full rounded-full p-[2px] bg-black">
                                            <img src={story.userPhoto} className="w-full h-full rounded-full object-cover group-hover:scale-105 transition-transform" decoding="async"/>
                                        </div>
                                    </div>
                                    <p className="text-xs text-white truncate w-16 text-center font-medium">{story.uid === user?.uid ? 'You' : story.username}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'rooms' && (
                <div className="space-y-4">
                    <button onClick={createRoom} className="w-full py-5 border border-yellow-500/30 bg-yellow-500/5 rounded-3xl text-yellow-500 font-bold font-display flex items-center justify-center gap-2 hover:bg-yellow-500/10 transition-all active:scale-[0.98]">
                        <div className="bg-yellow-500 text-black p-1 rounded-full"><Icons.Plus size={16}/></div>
                        CREATE PARTY ROOM
                    </button>
                    {rooms.map(room => (
                        <div key={room.id} onClick={() => joinRoom(room)} className="relative group overflow-hidden rounded-3xl cursor-pointer border border-white/5 shadow-2xl">
                           <div className="absolute inset-0 bg-gradient-to-br from-purple-900 to-black group-hover:scale-110 transition-transform duration-700"></div>
                           <div className="absolute inset-0 bg-black/40"></div>
                           <div className="relative p-6 flex justify-between items-center">
                                <div>
                                    <h3 className="font-display font-bold text-2xl text-white mb-1">{room.name}</h3>
                                    <div className="flex items-center gap-2">
                                        <img src={room.hostPhoto} className="w-6 h-6 rounded-full border border-yellow-500" decoding="async"/>
                                        <span className="text-xs text-gray-300 font-medium">Host: {room.hostName}</span>
                                    </div>
                                    <div className="mt-3 flex items-center gap-2">
                                        <div className="flex -space-x-2">
                                            {room.speakers.slice(0,3).map((sp, i) => (
                                                <div key={i} className="w-6 h-6 rounded-full bg-gray-700 border border-black flex items-center justify-center text-[8px] text-white">
                                                    {sp.slice(0,1)}
                                                </div>
                                            ))}
                                        </div>
                                        <span className="text-xs text-gray-400">{room.speakers.length} online</span>
                                    </div>
                                </div>
                                <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.2)]">
                                    <Icons.Mic size={24} className="animate-pulse"/>
                                </div>
                           </div>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* Modals remain mostly the same, ensuring images have decoding="async" */}
        {showAddFriend && (
          <div className="absolute inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-6">
            <div className="w-full max-w-sm bg-[#121212] border border-white/10 rounded-[32px] p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-display text-2xl font-bold text-white">Add Friend</h3>
                <button onClick={() => setShowAddFriend(false)} className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center text-gray-400 hover:text-white"><Icons.X size={18}/></button>
              </div>
              <input value={friendSearch} onChange={(e) => setFriendSearch(e.target.value.toLowerCase())} placeholder="Enter Username ID" className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white mb-4 focus:outline-none focus:border-yellow-500 transition-colors"/>
              <button onClick={sendFriendRequest} className="w-full bg-yellow-500 text-black font-bold py-4 rounded-2xl shadow-lg shadow-yellow-500/20 active:scale-95 transition-transform">SEND REQUEST</button>
            </div>
          </div>
        )}
        
        {showStoryUpload && (
            <div className="absolute inset-0 z-50 bg-black flex flex-col">
                <div className="p-4 flex justify-between items-center bg-black">
                    <button onClick={() => setShowStoryUpload(false)} className="p-2"><Icons.X className="text-white"/></button>
                    <h3 className="text-white font-bold">New Status</h3>
                    <button onClick={uploadStory} disabled={!storyFile} className="text-yellow-500 font-bold disabled:opacity-50 px-4">POST</button>
                </div>
                <div className="flex-1 bg-gray-900 relative flex flex-col justify-center">
                    {storyFile ? (
                        <img src={URL.createObjectURL(storyFile)} className="w-full h-full object-contain bg-black" decoding="async"/>
                    ) : (
                        <div onClick={() => document.getElementById('story-input')?.click()} className="h-full flex flex-col items-center justify-center cursor-pointer text-gray-500 hover:text-white transition-colors">
                            <Icons.Image size={64} className="mb-4 opacity-50"/>
                            <p className="text-lg">Tap to select photo</p>
                        </div>
                    )}
                    <input type="file" id="story-input" hidden accept="image/*" onChange={(e) => setStoryFile(e.target.files?.[0] || null)} />
                </div>
                <div className="p-4 bg-black border-t border-white/10">
                    <input value={storyCaption} onChange={e => setStoryCaption(e.target.value)} placeholder="Add a caption..." className="w-full bg-white/10 text-white p-4 rounded-2xl focus:outline-none"/>
                </div>
            </div>
        )}

        {viewingStory && (
            <div className="absolute inset-0 z-[60] bg-black flex flex-col">
                <div className="h-1 bg-gray-800 w-full flex pt-safe-top">
                    <div className="h-full bg-white w-full animate-[width_5s_linear]"></div>
                </div>
                <div className="p-4 flex justify-between items-center absolute top-2 w-full z-10 pt-8">
                    <div className="flex items-center gap-3">
                        <img src={viewingStory.userPhoto} className="w-10 h-10 rounded-full border border-white/50" decoding="async"/>
                        <div className="flex flex-col">
                             <span className="text-white font-bold text-sm shadow-black drop-shadow-md">{viewingStory.username}</span>
                             <span className="text-white/70 text-xs shadow-black drop-shadow-md">{new Date(viewingStory.createdAt?.toMillis()).toLocaleTimeString()}</span>
                        </div>
                    </div>
                    <button onClick={() => {setViewingStory(null); setShowViewers(false);}}><Icons.X className="text-white drop-shadow-md" size={28}/></button>
                </div>
                <div className="flex-1 flex items-center justify-center bg-black relative">
                    <img src={viewingStory.imageUrl} className="max-w-full max-h-full object-contain" decoding="async"/>
                    {viewingStory.text && (
                        <div className="absolute bottom-24 bg-black/60 px-6 py-3 rounded-2xl backdrop-blur-md max-w-[90%]">
                            <p className="text-white text-center text-lg">{viewingStory.text}</p>
                        </div>
                    )}
                </div>
                {/* Footer and Viewers UI remains the same... */}
                <div className="h-24 bg-gradient-to-t from-black/90 to-transparent flex justify-center items-end pb-8 absolute bottom-0 w-full">
                    {viewingStory.uid === user?.uid && (
                        <div className="flex flex-col items-center cursor-pointer p-4" onClick={() => setShowViewers(!showViewers)}>
                            <div className="flex items-center gap-2 text-white bg-white/10 px-4 py-2 rounded-full backdrop-blur-md">
                                <Icons.Eye size={16}/>
                                <span className="font-bold">{viewingStory.views?.length || 0}</span>
                            </div>
                        </div>
                    )}
                    {viewingStory.uid === user?.uid && (
                        <button onClick={() => deleteStory(viewingStory.id)} className="absolute right-6 bottom-8 text-white hover:text-red-500"><Icons.Trash size={24}/></button>
                    )}
                </div>
                {showViewers && (
                    <div className="absolute bottom-0 w-full h-2/3 bg-[#121212] rounded-t-[40px] p-6 transition-transform z-20 overflow-y-auto border-t border-white/10 shadow-2xl">
                        <div className="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-6"></div>
                        <h3 className="text-white font-bold text-xl mb-6">Viewed by</h3>
                        {viewingStory.views?.map((v, i) => (
                            <div key={i} className="flex items-center gap-4 mb-4">
                                <img src={v.photo} className="w-12 h-12 rounded-full object-cover border border-white/10" decoding="async"/>
                                <div>
                                    <p className="text-white font-medium">{v.name}</p>
                                    <p className="text-gray-500 text-xs">{new Date(v.viewedAt).toLocaleTimeString()}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )}
      </div>
    );
  }

  // 3. Chat View
  if (view === 'chat' && activeChat && activeChatUser) {
    return (
        <div className="h-screen w-screen bg-[#0a0a0a] flex flex-col relative">
            <BalochBackground />
            <div className="h-20 px-4 flex items-center gap-4 border-b border-white/5 bg-[#121212]/80 backdrop-blur-md z-10 pt-2">
                <button onClick={() => setView('home')} className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-white"><Icons.LogOut className="rotate-180" size={24}/></button>
                <img src={activeChatUser.photoURL} className="w-10 h-10 rounded-full object-cover border border-white/10" decoding="async"/>
                <div className="flex-1">
                    <h3 className="font-bold text-white text-lg leading-tight">{activeChatUser.displayName}</h3>
                    <span className="text-xs text-green-500 font-medium flex items-center gap-1"><span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span> Online</span>
                </div>
                <div className="flex gap-4">
                    <button className="text-yellow-500 hover:text-yellow-400"><Icons.Phone size={22}/></button>
                    <button className="text-yellow-500 hover:text-yellow-400"><Icons.Video size={22}/></button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 z-0">
                {messages.map((msg, i) => (
                    <MessageBubble key={i} msg={msg} isMe={msg.senderId === user?.uid} />
                ))}
            </div>

            <div className="p-4 bg-[#121212] flex items-center gap-3 z-10 pb-6 border-t border-white/5">
                <button className="text-gray-400 hover:text-yellow-500 transition-colors"><Icons.Plus size={26}/></button>
                <div className="flex-1 bg-[#2a2a2a] rounded-full flex items-center px-5 py-3 border border-white/5 focus-within:border-yellow-500/50 transition-colors">
                    <input value={msgText} onChange={e => setMsgText(e.target.value)} placeholder="Type a message..." className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none text-base h-full" onKeyDown={(e) => e.key === 'Enter' && sendMessage()}/>
                </div>
                <button onClick={sendMessage} className="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center text-black shadow-lg shadow-yellow-500/20 active:scale-95 transition-transform"><Icons.Send size={20} className="ml-1"/></button>
            </div>
        </div>
    )
  }

  // 4. Room View (IMO Style) with HD Audio UI
  if (view === 'room' && activeRoom) {
      const speakers = activeRoom.speakers || [];
      const hostId = activeRoom.hostUid;
      const guests = speakers.filter(uid => uid !== hostId);
      
      return (
          <div className="h-screen w-screen bg-[#1a0b2e] flex flex-col relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-purple-900/40 via-transparent to-black z-0"></div>
              <BalochBackground />
              <div className="absolute top-0 left-0 right-0 p-4 pt-6 flex justify-between items-center z-20">
                  <button onClick={leaveRoom} className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white border border-white/10"><Icons.LogOut className="rotate-180" size={20}/></button>
                  <div className="bg-black/60 backdrop-blur-md px-6 py-2 rounded-full border border-white/10 shadow-xl flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                      <span className="text-yellow-400 font-display font-bold uppercase tracking-widest text-sm">{activeRoom.name}</span>
                      <span className="text-[10px] text-gray-400 ml-2 border-l border-gray-600 pl-2">HD AUDIO</span>
                  </div>
                  <button className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white border border-white/10"><Icons.More/></button>
              </div>

              <div className="flex-1 flex flex-col items-center pt-24 z-10">
                  <div className="relative mb-16">
                      <div className="w-36 h-36 rounded-full p-1.5 bg-gradient-to-b from-yellow-300 via-amber-500 to-yellow-700 shadow-[0_0_60px_rgba(234,179,8,0.3)] z-10 relative">
                          <img src={activeRoom.hostPhoto} className="w-full h-full rounded-full object-cover border-4 border-[#1a0b2e]" decoding="async"/>
                      </div>
                      <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-yellow-500 to-amber-600 text-black text-[11px] font-black px-3 py-1 rounded-full flex items-center gap-1 shadow-lg z-20 border border-white/20">
                          <Icons.Crown size={12}/> HOST
                      </div>
                      <div className="absolute -bottom-12 w-full text-center">
                          <p className="text-white font-bold text-lg drop-shadow-md">{activeRoom.hostName}</p>
                      </div>
                      <div className="absolute inset-0 rounded-full border-2 border-yellow-500/30 animate-pulse-ring -z-0"></div>
                  </div>

                  <div className="flex gap-4 sm:gap-8 mt-6">
                      {[0, 1, 2].map((i) => {
                          const guestUid = guests[i];
                          return (
                              <div key={i} className="flex flex-col items-center group">
                                  {guestUid ? (
                                      <div className="relative">
                                          <div className="w-24 h-24 rounded-full bg-gray-800 border-2 border-purple-500 p-1 relative z-10">
                                              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${guestUid}`} className="w-full h-full rounded-full bg-black" decoding="async"/>
                                              <div className="absolute bottom-0 right-0 w-7 h-7 bg-green-500 border-4 border-[#1a0b2e] rounded-full flex items-center justify-center text-black shadow-lg">
                                                  <Icons.Mic size={12} className="text-black fill-current"/>
                                              </div>
                                          </div>
                                      </div>
                                  ) : (
                                      <div className="w-24 h-24 rounded-full bg-white/5 border-2 border-dashed border-white/20 flex items-center justify-center text-white/20 group-hover:border-white/40 group-hover:bg-white/10 transition-all cursor-pointer">
                                          <Icons.Plus size={32}/>
                                      </div>
                                  )}
                                  <p className="text-xs text-gray-400 mt-3 font-medium tracking-wide">{guestUid ? `Guest ${i+1}` : 'Empty Seat'}</p>
                              </div>
                          )
                      })}
                  </div>
              </div>

              <div className="bg-[#121212]/95 backdrop-blur-xl rounded-t-[40px] p-8 pb-10 border-t border-white/10 z-20">
                   <div className="flex justify-between items-center px-2 mb-8">
                       <p className="text-gray-400 text-sm flex items-center gap-2"><div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div> Room Chat</p>
                       <p className="text-yellow-500 text-[10px] font-black tracking-[0.2em] bg-yellow-500/10 px-2 py-1 rounded border border-yellow-500/20">VIP ONLY</p>
                   </div>
                   
                   <div className="flex items-center justify-around relative">
                       <div className="flex flex-col items-center gap-2">
                           <button className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-all active:scale-95"><Icons.Chat size={24}/></button>
                           <span className="text-[10px] text-gray-500 uppercase tracking-wide font-bold">Chat</span>
                       </div>
                       
                       <div className="relative -top-8">
                           <button onClick={toggleMic} className={`w-24 h-24 rounded-full flex items-center justify-center text-black shadow-2xl transition-transform active:scale-95 border-[6px] border-[#121212] ${micActive ? 'bg-green-500 shadow-[0_0_50px_rgba(34,197,94,0.4)]' : 'bg-gradient-to-r from-yellow-500 to-amber-600 shadow-yellow-500/20'}`}>
                               {micActive ? <Icons.Mic size={40} className="fill-black animate-pulse"/> : <Icons.MicOff size={40}/>}
                           </button>
                       </div>

                       <div className="flex flex-col items-center gap-2">
                           <button className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-all active:scale-95"><Icons.User size={24}/></button>
                           <span className="text-[10px] text-gray-500 uppercase tracking-wide font-bold">Profile</span>
                       </div>
                   </div>
              </div>
          </div>
      )
  }

  return null;
}