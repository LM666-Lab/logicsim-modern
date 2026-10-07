import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 挂载点');

// 不用 StrictMode：JointJS 是命令式的，开发期的双次挂载会重复创建 Paper。
createRoot(container).render(<App />);
