const
    path = require('path'),
    HtmlWebpackPlugin = require('html-webpack-plugin'),
    CopyPlugin = require("copy-webpack-plugin"),
    { CleanWebpackPlugin } = require('clean-webpack-plugin'),
    OverwolfPlugin = require('./overwolf.webpack'),
    webpack = require('webpack');

module.exports = env => {
    // Determine build mode
    const isDebugMode = env.debugMode === true;
    const isProdMode = env.prodMode === true;
    
    console.log(`Building in ${isDebugMode ? 'DEBUG' : 'PRODUCTION'} mode`);
    
    return {
        entry: {
            background: './src/background/background.ts',
            unified: './src/unified/unified.ts'
        },
        devtool: 'inline-source-map',
        module: {
            rules: [
                {
                    test: /\.ts?$/,
                    use: 'ts-loader',
                    exclude: /node_modules/
                }
            ]
        },
        resolve: {
            extensions: ['.ts', '.js']
        },
        output: {
          path: path.resolve(__dirname, 'dist/'),
          filename: 'js/[name].js'
        },
        plugins: [
            new CleanWebpackPlugin,
            new CopyPlugin({
                patterns: [ { from: "public", to: "./" } ],
            }),
            new webpack.DefinePlugin({
                'process.env.DEBUG_MODE': JSON.stringify(isDebugMode),
                'process.env.PROD_MODE': JSON.stringify(isProdMode)
            }),
            new HtmlWebpackPlugin({
                template: './src/background/background.html',
                filename: path.resolve(__dirname, './dist/background.html'),
                chunks: ['background']
            }),
            new HtmlWebpackPlugin({
                template: './src/unified/unified.html',
                filename: path.resolve(__dirname, './dist/unified.html'),
                chunks: ['unified']
            }),
            new OverwolfPlugin(env)
        ]
    }
}
