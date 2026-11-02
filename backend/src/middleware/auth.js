import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import User from '../models/User.js';

export const requireAuth = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let decoded;
  try {
    decoded = jwt.verify(authorization.slice('Bearer '.length), config.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }

  try {
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ error: 'Account no longer exists' });
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Not authorized as admin' });
  }
};
