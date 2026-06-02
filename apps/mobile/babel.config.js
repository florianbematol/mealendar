module.exports = (api) => {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          unstable_transformImportMeta: true,
        },
      ],
    ],
    // react-native-reanimated necessite ce plugin EN DERNIER (worklets compilation).
    plugins: ['react-native-worklets/plugin'],
  };
};
