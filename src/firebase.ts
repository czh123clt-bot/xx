import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const signIn = async () => {
  try {
    await signInAnonymously(auth);
  } catch (error: any) {
    console.error("Error signing in anonymously:", error);
    alert("连接服务器失败！\n请不要使用【微信内置浏览器】或【无痕/隐私模式】打开此网页，这会拦截数据库连接。\n\n详细错误: " + error.message);
  }
};
