export interface User {
  uid: string;
  email: string | null;
  username: string; // The unique ID for adding friends
  displayName: string;
  photoURL: string;
  bio?: string;
  isOnline?: boolean;
}

export interface FriendRequest {
  id: string;
  fromUid: string;
  fromName: string;
  fromPhoto: string;
  toUid: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: any;
}

export interface Chat {
  id: string;
  participants: string[];
  lastMessage: string;
  lastMessageTime: any;
  unreadCount?: number;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  imageUrl?: string;
  createdAt: any;
}

export interface Room {
  id: string;
  name: string;
  hostUid: string;
  hostName: string;
  hostPhoto: string;
  speakers: string[]; // Array of UIDs currently in seats
  viewers: number;
}

export interface Story {
  id: string;
  uid: string;
  username: string;
  userPhoto: string;
  imageUrl: string;
  text?: string;
  createdAt: any;
  views: Viewer[]; // Track who viewed the story
}

export interface Viewer {
  uid: string;
  name: string;
  photo: string;
  viewedAt: any;
}
