import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  timeout: 30000
});

api.interceptors.request.use((request) => {
  const token = sessionStorage.getItem('aerorag-token');
  if (token) request.headers.Authorization = `Bearer ${token}`;
  return request;
});

export function getErrorMessage(error) {
  if (error.response?.data?.error) return error.response.data.error;
  if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  if (!error.response) return 'Cannot reach the AeroRAG API. Check that the backend is running.';
  return 'The request failed. Please try again.';
}
