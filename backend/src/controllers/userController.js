import User from '../models/User.js';

export const listUsers = async (req, res, next) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    next(error);
  }
};

export const updateUserRole = async (req, res, next) => {
  try {
    const { role } = req.body ?? {};
    if (!role || !['admin', 'ground_staff'].includes(role)) {
      return res.status(400).json({ error: "Role must be 'admin' or 'ground_staff'" });
    }

    if (String(req.user._id) === String(req.params.id) && role !== 'admin') {
      return res.status(400).json({ error: 'Admins cannot revoke their own administrator role' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    if (String(req.user._id) === String(req.params.id)) {
      return res.status(400).json({ error: 'You cannot delete your own active account' });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ message: `User ${user.email} removed successfully` });
  } catch (error) {
    next(error);
  }
};

